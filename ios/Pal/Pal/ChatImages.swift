import CryptoKit
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Cache eviction releases idle files; a presented Quick Look gallery retains its own handles.
final class ImagePreviewFile: NSObject, @unchecked Sendable {
  let url: URL
  let byteCount: Int

  private init(url: URL, byteCount: Int) {
    self.url = url
    self.byteCount = byteCount
  }

  @concurrent static func create(_ bytes: Data) async throws -> ImagePreviewFile {
    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
      let type = CGImageSourceGetType(source),
      let extensionName = UTType(type as String)?.preferredFilenameExtension
    else { throw ChatError.rejected(400) }
    let folder = FileManager.default.temporaryDirectory.appending(
      path: "pal-image-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: "Image." + extensionName)
    do {
      try bytes.write(to: url, options: [.atomic, .completeFileProtection])
      return ImagePreviewFile(url: url, byteCount: bytes.count)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      throw error
    }
  }

  @concurrent func data() async throws -> Data { try Data(contentsOf: url) }

  deinit { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
}

/// Durable upload sources are separate from the purgeable display cache.
struct DraftImageFiles: Sendable {
  let directory: URL

  init(key: String, directory: URL? = nil) {
    let scope = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    self.directory =
      directory
      ?? FileManager.default.urls(
        for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appending(path: "Pal/DraftImages/" + scope, directoryHint: .isDirectory)
  }

  private func file(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw ChatError.rejected(400) }
    return directory.appending(path: id + ".jpg")
  }

  @concurrent func save(_ bytes: Data, id: String) async throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try bytes.write(
      to: file(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  @concurrent func data(_ id: String) async throws -> Data {
    try Data(contentsOf: file(id))
  }

  func remove(_ id: String) {
    if let url = try? file(id) { try? FileManager.default.removeItem(at: url) }
  }

  func removeUnused(keeping ids: Set<String>) {
    let files =
      (try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: nil)) ?? []
    for url in files where url.pathExtension == "jpg" {
      if !ids.contains(url.deletingPathExtension().lastPathComponent) {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }
}

@MainActor final class ChatImages {
  let drafts: DraftImageFiles
  private let cache = NSCache<NSString, UIImage>()
  private let originals = NSCache<NSString, ImagePreviewFile>()
  private var loading: [String: Task<UIImage, Error>] = [:]
  private var loadingOriginals: [String: Task<ImagePreviewFile, Error>] = [:]

  init(key: String, directory: URL? = nil) {
    drafts = DraftImageFiles(key: key, directory: directory)
    cache.totalCostLimit = 64 * 1024 * 1024
    originals.totalCostLimit = 64 * 1024 * 1024
  }

  func cached(_ id: String) -> UIImage? { cache.object(forKey: id as NSString) }
  func remove(_ id: String) {
    cache.removeObject(forKey: id as NSString)
    originals.removeObject(forKey: id as NSString)
  }

  func handoff(from source: String, to destination: String) {
    guard source != destination else { return }
    if let image = cached(source) {
      cache.removeObject(forKey: source as NSString)
      remember(image, id: destination)
    }
    if let file = originals.object(forKey: source as NSString) {
      originals.removeObject(forKey: source as NSString)
      originals.setObject(file, forKey: destination as NSString, cost: file.byteCount)
    }
  }

  private func remember(_ image: UIImage, id: String) {
    let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
    cache.setObject(image, forKey: id as NSString, cost: cost)
  }

  func preview(_ id: String, load: @escaping @MainActor () async throws -> Data) async throws
    -> ImagePreviewFile
  {
    if let file = originals.object(forKey: id as NSString) { return file }
    if let task = loadingOriginals[id] { return try await task.value }
    let task = Task { try await ImagePreviewFile.create(load()) }
    loadingOriginals[id] = task
    defer { loadingOriginals[id] = nil }
    let file = try await task.value
    originals.setObject(file, forKey: id as NSString, cost: file.byteCount)
    return file
  }

  func image(_ id: String, load: @escaping @MainActor () async throws -> Data) async throws
    -> UIImage
  {
    if let image = cached(id) { return image }
    if let task = loading[id] { return try await task.value }
    let task = Task {
      let file = try await preview(id, load: load)
      let bytes = try await file.data()
      return try await ChatImageDecoding.prepare(bytes)
    }
    loading[id] = task
    defer { loading[id] = nil }
    let image = try await task.value
    remember(image, id: id)
    return image
  }
}

private enum ChatImageDecoding {
  @concurrent static func prepare(_ bytes: Data) async throws -> UIImage {
    guard let image = UIImage(data: bytes), let prepared = await image.byPreparingForDisplay()
    else {
      throw ChatError.rejected(400)
    }
    return prepared
  }
}
