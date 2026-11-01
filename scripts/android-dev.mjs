#!/usr/bin/env node
// Prepare/restore only Pal's selected OrbStack USB phone. No host ADB is used.
// Called by scripts/dev-local android-{up,reconnect,down}; state stays in .local.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const project = process.env.PAL_DEV_PROJECT || "pal-dev-split";
const dir = resolve(
  root,
  ".local",
  project === "pal-dev-split" ? "dev-local" : `dev-local-${project}`,
);
const statePath = resolve(dir, "android.json");
const envPath = resolve(dir, "android.env");
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  }).trim();
const previous = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : undefined;
if (process.argv[2] === "down") {
  if (previous?.owned) {
    const devices = JSON.parse(
      run("orb", ["usb", "list", "-f", "json"]),
    ).devices;
    if (
      devices.some(
        (d) => d.bus_id === previous.bus && d.serial_number === previous.serial,
      )
    )
      run("orb", ["usb", "detach", previous.bus]);
  }
  rmSync(statePath, { force: true });
  rmSync(envPath, { force: true });
  process.exit(0);
}
let attached = false;
let bus;
try {
  const devices = JSON.parse(run("orb", ["usb", "list", "-f", "json"])).devices;
  const wanted = process.env.PAL_ANDROID_DEVICE_ID || previous?.serial;
  const candidates = devices.filter(
    (d) =>
      d.serial_number &&
      (wanted
        ? d.serial_number === wanted
        : d.interfaces?.some(
            (i) => i.class === 255 && i.sub_class === 66 && i.protocol === 1,
          )),
  );
  if (candidates.length !== 1)
    throw Error(
      "Connect one USB Android phone or set PAL_ANDROID_DEVICE_ID to its serial.",
    );
  const device = candidates[0];
  bus = device.bus_id;
  if (!/^[A-Za-z0-9._-]+$/.test(device.serial_number))
    throw Error("Unsupported USB serial format");
  const info = run("orb", ["usb", "info", bus]);
  if (info.includes("Machine: Not attached")) {
    console.log(run("orb", ["usb", "attach", bus]));
    attached = true;
  }
  const script =
    'for d in /sys/bus/usb/devices/*; do if [ "$(cat "$d/serial" 2>/dev/null)" = "$1" ]; then printf "/dev/bus/usb/%03d/%03d\n" "$(cat "$d/busnum")" "$(cat "$d/devnum")"; fi; done';
  let node;
  for (let attempt = 0; attempt < 15; attempt++) {
    node = run("docker", [
      "run",
      "--rm",
      "--name",
      `${project}-android-usb-probe`,
      "--label",
      "pal.task=android-mobile-mcp",
      "--network",
      "none",
      "--mount",
      "type=bind,src=/sys,dst=/sys,readonly",
      "busybox:1.36@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662",
      "sh",
      "-c",
      script,
      "probe",
      device.serial_number,
    ]);
    if (/^\/dev\/bus\/usb\/\d{3}\/\d{3}$/.test(node)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!/^\/dev\/bus\/usb\/\d{3}\/\d{3}$/.test(node))
    throw Error(
      "Phone not visible in Docker Linux. Check OrbStack USB attachment.",
    );
  const token = previous?.token || randomBytes(32).toString("hex");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    statePath,
    JSON.stringify({
      serial: device.serial_number,
      bus,
      owned: attached || previous?.owned || false,
      token,
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    envPath,
    `PAL_ANDROID_DEVICE_ID=${device.serial_number}\nPAL_ANDROID_USB_DEVICE=${node}\nPAL_ANDROID_MCP_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
  console.log(`Selected Android USB phone at ${node}.`);
} catch (error) {
  if (attached) {
    try {
      run("orb", ["usb", "detach", bus]);
    } catch {}
  }
  console.error(error.message);
  process.exitCode = 1;
}
