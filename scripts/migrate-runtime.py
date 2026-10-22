#!/usr/bin/env python3
"""Offline, copy-only cutover preparation for the legacy Compose runtime."""
import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import time

os.umask(0o077)

def docker(*args, **kwargs):
    return subprocess.run(["docker", *args], check=True, **kwargs)

def inspect(container):
    return json.loads(docker("inspect", container, capture_output=True).stdout)[0]

def archive(command, path):
    with path.open("wb") as output:
        docker(*command, stdout=output)

def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError("Unsafe archive path")
    return str(path).removeprefix("./")

def member_copy(source, output, member, name, secrets=()):
    clone = tarfile.TarInfo(name)
    clone.mode, clone.mtime = member.mode, member.mtime
    clone.uid = clone.gid = 1000
    if member.isdir():
        clone.type = tarfile.DIRTYPE
        output.addfile(clone)
    elif member.issym():
        clone.type, clone.linkname = tarfile.SYMTYPE, member.linkname
        output.addfile(clone)
    elif member.isfile() or member.islnk():
        with source.extractfile(member) as stream:
            # Check secret copies without logging their contents.
            data = stream.read()
        if any(secret in data for secret in secrets):
            raise RuntimeError("Service credential copy found in " + name)
        clone.size = len(data)
        output.addfile(clone, io.BytesIO(data))
    else:
        raise RuntimeError("Unsupported persistent file: " + name)

def tokens(value):
    if isinstance(value, dict):
        return [item for child in value.values() for item in tokens(child)]
    if isinstance(value, list):
        return [item for child in value for item in tokens(child)]
    return [value.encode()] if isinstance(value, str) and len(value) >= 20 else []

def prepare(args):
    legacy, postgres = inspect(args.legacy), inspect(args.postgres)
    if legacy["State"]["Running"]:
        raise RuntimeError("Stop legacy Pal and all writers before preparing migration")
    if not postgres["State"]["Running"]:
        raise RuntimeError("PostgreSQL must be running for its consistent backup")
    mounts = {m["Destination"]: m for m in legacy["Mounts"]}
    if mounts.get("/data", {}).get("Type") not in ("volume", "bind"):
        raise RuntimeError("Expected the legacy persistent mount at /data")
    if legacy["Config"].get("Hostname") is None:
        raise RuntimeError("Legacy hostname is required")
    # Never overwrite any target state, even after a partial attempt.
    names = {kind: args.project + "_" + kind for kind in
             ("agent_home", "service_data", "postgres_data")}
    for name in names.values():
        found = subprocess.run(["docker", "volume", "inspect", name],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if found.returncode == 0:
            raise RuntimeError("Target volume already exists: " + name)
    directory = Path(args.backup).resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    (directory / "legacy-inspect.json").write_text(json.dumps(legacy))
    (directory / "postgres-inspect.json").write_text(json.dumps(postgres))
    print("Backing up the stopped runtime and persistent data", flush=True)
    archive(("export", legacy["Id"]), directory / "legacy-rootfs.tar")
    archive(("run", "--rm", "--network=none", "--user=0",
             "--volumes-from", legacy["Id"] + ":ro", args.helper,
             "tar", "-C", "/data", "-cpf", "-", "."), directory / "legacy-data.tar")
    archive(("exec", postgres["Id"], "pg_dump", "-U", "pal", "-d", "pal", "-Fc"),
            directory / "postgres.dump")
    archive(("diff", legacy["Id"]), directory / "legacy-filesystem-changes.txt")
    tables = docker("exec", postgres["Id"], "psql", "-U", "pal", "-d", "pal",
                    "-At", "-F", "\t", "-c",
                    "select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog', 'information_schema')",
                    capture_output=True).stdout.decode().splitlines()
    paths = {}
    for table in tables:
        schema, name = table.split("\t")
        identifier = lambda value: '"' + value.replace('"', '""') + '"'
        rows = docker("exec", postgres["Id"], "psql", "-U", "pal", "-d", "pal",
                      "-At", "-c", "select row_to_json(t)::text from " +
                      identifier(schema) + "." + identifier(name) + " t",
                      capture_output=True).stdout.decode()
        found = sorted(set(re.findall(r"/data/(?:home|workspace|uploads|agent)(?:/[^\s\\\"<>]*)?", rows)))
        if found:
            paths[table] = found
    (directory / "legacy-paths.json").write_text(json.dumps(paths, indent=2) + "\n")
    private = []
    for entry in legacy["Config"].get("Env", []):
        key, _, value = entry.partition("=")
        if re.search(r"(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)", key) and len(value) >= 8:
            private.append(value.encode())
    with tarfile.open(directory / "legacy-data.tar") as source:
        for member in source:
            name = safe_name(member.name)
            if name == "agent/auth.json" and member.isfile():
                private.extend(tokens(json.load(source.extractfile(member))))
    # Export/import drops every inherited Docker ENV value and image config.
    # Remove application/private/runtime trees BEFORE importing, so no secret lower layer exists.
    excluded = ("data", "opt/pal", "root", "home", "tmp", "run", "var/log")
    with tarfile.open(directory / "legacy-rootfs.tar") as source, \
         tarfile.open(directory / "execution-rootfs.tar", "w") as target:
        for member in source:
            name = safe_name(member.name)
            if any(name == prefix or name.startswith(prefix + "/") for prefix in excluded):
                continue
            if name in ("etc/environment", "etc/hostname", "etc/hosts", "etc/resolv.conf"):
                continue
            if member.isfile() and member.size:
                # Stream the scan; a package/utility may be larger than available RAM.
                with source.extractfile(member) as stream:
                    tail = b""
                    while block := stream.read(1024 * 1024):
                        if any(secret in tail + block for secret in private):
                            raise RuntimeError("Service credential copy found in root filesystem: " + name)
                        tail = (tail + block)[-max([len(s) for s in private] or [1]):]
            target.addfile(member, source.extractfile(member) if member.isfile() else None)
    with tarfile.open(directory / "legacy-data.tar") as source, \
         tarfile.open(directory / "agent-home.tar", "w") as home, \
         tarfile.open(directory / "service-data.tar", "w") as service:
        for member in source:
            name = safe_name(member.name)
            if name in (".", "home", "workspace", "uploads", "agent"):
                continue
            if name.startswith("home/"):
                dest = name[5:]
                if PurePosixPath(dest).name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
                    continue
                if dest in ("workspace", "incoming") or dest.startswith(("workspace/", "incoming/")):
                    if member.isdir():
                        continue
                    raise RuntimeError("Legacy home conflicts with managed workspace/incoming")
                member_copy(source, home, member, dest, private)
            elif name.startswith("workspace/"):
                member_copy(source, home, member, name, private)
            elif name.startswith("uploads/"):
                if not member.isfile():
                    raise RuntimeError("Canonical attachment is not a regular file")
                member_copy(source, service, member, name)
                member_copy(source, home, member, "incoming/" + name[8:], private)
            else:
                dest = name if name.startswith("agent/") else "legacy/" + name
                if member.issym() or member.islnk():
                    raise RuntimeError("Private legacy data contains a link: " + name)
                member_copy(source, service, member, dest)
    print("Importing sanitized execution base and restoring copied volumes", flush=True)
    image = args.project + "-execution-preserved:cutover"
    with (directory / "execution-rootfs.tar").open("rb") as stream:
        docker("import", "-", image, stdin=stream, stdout=subprocess.DEVNULL)
    for name in names.values():
        docker("volume", "create", name, stdout=subprocess.DEVNULL)
    for kind, filename in (("agent_home", "agent-home.tar"), ("service_data", "service-data.tar")):
        directories = ("tmp", "workspace", "incoming") if kind == "agent_home" else ("home", "uploads", "agent")
        docker("run", "--rm", "--network=none", "--user=0",
               "-v", names[kind] + ":/target", args.helper, "mkdir", "-p",
               *["/target/" + name for name in directories])
        with (directory / filename).open("rb") as stream:
            docker("run", "--rm", "--network=none", "--user=0", "-i",
                   "-v", names[kind] + ":/target", args.helper,
                   "tar", "-C", "/target", "-xpf", "-", stdin=stream)
        docker("run", "--rm", "--network=none", "--user=0",
               "-v", names[kind] + ":/target", args.helper,
               "chown", "-R", "--no-dereference", "1000:1000", "/target")
    db = args.project + "-restore"
    docker("run", "-d", "--name", db, "--network=none",
           "-e", "POSTGRES_USER=pal", "-e", "POSTGRES_PASSWORD=pal",
           "-e", "POSTGRES_DB=pal", "-v",
           names["postgres_data"] + ":/var/lib/postgresql/data",
           postgres["Config"]["Image"], stdout=subprocess.DEVNULL)
    try:
        for attempt in range(60):
            ready = subprocess.run(["docker", "exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "pal", "-d", "pal"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Migration PostgreSQL did not become ready")
        with (directory / "postgres.dump").open("rb") as stream:
            docker("exec", "-i", db, "pg_restore", "-U", "pal", "-d", "pal",
                   "--exit-on-error", "--no-owner", stdin=stream)
        # Preserve database authentication without exposing the stored password hash.
        password = docker("exec", postgres["Id"], "psql", "-U", "pal", "-d", "pal",
                          "-At", "-c", "select rolpassword from pg_authid where rolname = 'pal'",
                          capture_output=True).stdout.decode().strip()
        if password:
            statement = "alter role pal password '" + password.replace("'", "''") + "';\n"
            docker("exec", "-i", db, "psql", "-U", "pal", "-d", "pal", "-v", "ON_ERROR_STOP=1",
                   input=statement.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        docker("rm", "-f", db, stdout=subprocess.DEVNULL)
    manifest = {
        "legacyContainer": legacy["Id"], "postgresContainer": postgres["Id"],
        "legacyImage": legacy["Image"], "legacyStorage": mounts["/data"].get("Name", mounts["/data"]["Source"]),
        "project": args.project, "volumes": names, "executionBase": image,
        "hostname": legacy["Config"]["Hostname"],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (directory / "compose.env").write_text(
        "PAL_EXECUTION_BASE=" + image + "\nPAL_EXECUTION_IMAGE=" + args.project + "-execution:cutover\nPAL_EXECUTION_HOSTNAME=" +
        legacy["Config"]["Hostname"] + "\n")
    print("Prepared copied state and rollback backups in " + str(directory))
    print("Original containers, images, and volumes are retained and unchanged.")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--legacy", required=True, help="Stopped legacy Pal container")
parser.add_argument("--postgres", required=True, help="Running legacy PostgreSQL container")
parser.add_argument("--project", required=True, help="New Compose project with no existing target volumes")
parser.add_argument("--backup", required=True, help="New private backup directory")
parser.add_argument("--helper", default="pal-execution-local", help="Locally built execution helper image")
args = parser.parse_args()
if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,45}", args.project):
    parser.error("Invalid target project")
prepare(args)
