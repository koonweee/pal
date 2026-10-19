import Foundation
import OSLog
import Observation
import UIKit

@MainActor @Observable final class ConversationStore {
  private(set) var messages: [ChatMessage] = []
  private(set) var activity = AgentActivity(status: "idle")
  private(set) var connectionState = "Disconnected"
  private(set) var connectionError: String?
  private(set) var loading = false
  private(set) var sending = false
  let presentation: MessagePresentation
  let tasks: OwnerTasksStore
  let taskId: String?
  var before: Int? { historyPagination?.before }
  private(set) var attachmentIds: [String] = [] {
    didSet { defaults.set(attachmentIds, forKey: key + ".images") }
  }
  var draft: String { didSet { defaults.set(draft, forKey: key + ".draft") } }
  var error: String?
  var readingPosition: String? {
    didSet { defaults.set(readingPosition, forKey: key + ".position") }
  }

  private var hasRefreshedHistory = false
  private var service: any ChatService
  private let defaults: UserDefaults
  private let key: String
  private let images: ChatImages
  private var localImageIds: Set<String> = [] {
    didSet { defaults.set(Array(localImageIds), forKey: key + ".localImages") }
  }
  private var pending: MessageSubmission?
  private(set) var pendingAcknowledged = false
  private let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "com.example.pal", category: "connection")

  private struct HistoryPagination: Codable { let before: Int? }
  private var historyPagination: HistoryPagination?
  private struct CachedConversation: Codable {
    let messages: [ChatMessage]
    let pagination: HistoryPagination?
  }

  var hasPendingSend: Bool { pending != nil }
  var needsSendRetry: Bool { pending != nil && !pendingAcknowledged }
  var isAwaitingSendReconciliation: Bool { pending != nil && pendingAcknowledged }
  var optimisticMessage: ChatMessage? {
    guard let pending,
      !messages.contains(where: { $0.idempotencyKey == pending.idempotencyKey })
    else { return nil }
    return .optimistic(pending)
  }
  var displayedMessages: [ChatMessage] {
    if let optimisticMessage { return messages + [optimisticMessage] }
    return messages
  }
  var latestReadMessageID: String? {
    guard let latestUser = displayedMessages.last(where: { $0.role == "user" }),
      latestUser.id != optimisticMessage?.id
    else { return nil }
    return latestUser.id
  }

  init(
    service: any ChatService, taskId: String? = nil, key: String = "pal.native.chat",
    defaults: UserDefaults = .standard,
    presentation: MessagePresentation = MessagePresentation(), imageDirectory: URL? = nil
  ) {
    self.service = service
    self.taskId = taskId
    self.tasks = OwnerTasksStore(service: service)
    self.defaults = defaults
    self.key = key
    self.presentation = presentation
    images = ChatImages(key: key, directory: imageDirectory)
    draft = defaults.string(forKey: key + ".draft") ?? ""
    readingPosition = defaults.string(forKey: key + ".position")
    attachmentIds = defaults.stringArray(forKey: key + ".images") ?? []
    if let data = defaults.data(forKey: key + ".pending") {
      pending = try? JSONDecoder().decode(MessageSubmission.self, from: data)
      pendingAcknowledged = defaults.bool(forKey: key + ".pendingAcknowledged")
    }
    localImageIds = Set(defaults.stringArray(forKey: key + ".localImages") ?? [])
      .intersection(attachmentIds + (pending?.localAttachmentIds ?? []))
    images.drafts.removeUnused(keeping: localImageIds)
    if let data = defaults.data(forKey: key + ".conversation"),
      let cache = try? JSONDecoder().decode(CachedConversation.self, from: data)
    {
      messages = cache.messages.sorted { $0.sequence < $1.sequence }
      historyPagination = cache.pagination
    }
    clearUnavailableReadingPosition()
    reconcilePending()
    if pending != nil && !pendingAcknowledged {
      error = "A send was interrupted. Retry uses the same request."
    }
  }

  private func persistPending() {
    defaults.set(try? JSONEncoder().encode(pending), forKey: key + ".pending")
    defaults.set(pendingAcknowledged, forKey: key + ".pendingAcknowledged")
  }

  private func clearPending(discardImages: Bool = true) {
    if discardImages {
      for id in pending?.localAttachmentIds ?? [] {
        images.drafts.remove(id)
        localImageIds.remove(id)
      }
    }
    pending = nil
    pendingAcknowledged = false
    defaults.removeObject(forKey: key + ".pending")
    defaults.removeObject(forKey: key + ".pendingAcknowledged")
  }

  private func reconcilePending() {
    guard let pending,
      let canonical = messages.first(where: { $0.idempotencyKey == pending.idempotencyKey })
    else { return }
    for (source, destination) in zip(pending.localAttachmentIds, canonical.attachmentIds) {
      images.handoff(from: source, to: destination)
    }
    clearPending()
    error = nil
  }

  private func clearUnavailableReadingPosition() {
    if let readingPosition, !messages.contains(where: { $0.id == readingPosition }) {
      self.readingPosition = nil
    }
  }

  private func save() {
    let cachedMessages = Array(messages.suffix(ConversationHistory.pageSize))
    let pagination =
      messages.count > cachedMessages.count
      ? HistoryPagination(before: cachedMessages.first?.sequence) : historyPagination
    defaults.set(
      try? JSONEncoder().encode(
        CachedConversation(messages: cachedMessages, pagination: pagination)),
      forKey: key + ".conversation")
  }

  private func belongs(_ message: ChatMessage) -> Bool {
    if let taskId { return message.taskId == taskId }
    return message.taskId == nil || message.mainVisible == true
  }

  func apply(_ update: ChatUpdate, live: Bool = false) {
    switch update {
    case .message(let message):
      guard mergeMessages([message], presentAllNew: live) else { return }
      reconcilePending()
      save()
    case .activity(let value): activity = value
    case .task(let task): tasks.apply(task)
    case .heartbeat: break
    }
  }

  private func merge(_ page: HistoryPage, replacingInitial: Bool, liveAfter sequence: Int? = nil) {
    if replacingInitial {
      messages = page.messages.sorted { $0.sequence < $1.sequence }
      historyPagination = HistoryPagination(before: page.before)
      clearUnavailableReadingPosition()
    } else {
      mergeMessages(page.messages, liveAfter: sequence)
      if historyPagination == nil { historyPagination = HistoryPagination(before: page.before) }
    }
    hasRefreshedHistory = true
    reconcilePending()
    save()
  }

  private func refreshRetainedHistory() async throws {
    let retainedBoundary = hasRefreshedHistory ? messages.first?.sequence : nil
    var page = try await service.history(before: nil)
    merge(page, replacingInitial: !hasRefreshedHistory)
    guard let retainedBoundary else { return }
    while let cursor = page.before,
      let first = page.messages.first?.sequence,
      first > retainedBoundary
    {
      try Task.checkCancellation()
      page = try await service.history(before: cursor)
      merge(page, replacingInitial: false)
    }
  }

  func run() async {
    var attempts = 0
    while !Task.isCancelled {
      do {
        connectionState = attempts == 0 ? "Connecting" : "Reconnecting"
        loading = !hasRefreshedHistory || messages.isEmpty
        let updates = try await service.events()
        presentation.reset()
        try await refreshRetainedHistory()
        loading = false
        connectionState = "Connected"
        connectionError = nil
        attempts = 0
        for try await update in updates { apply(update, live: true) }
        throw ChatError.disconnected
      } catch {
        presentation.reset()
        loading = false
        activity = AgentActivity(status: "idle")
        if Task.isCancelled { break }
        let failure = error as NSError
        logger.error("Connection failed: \(failure.domain, privacy: .public) \(failure.code)")
        connectionState = "Reconnecting"
        connectionError = Self.connectionFailureMessage(error)
        attempts += 1
        do { try await Task.sleep(for: .seconds(min(15, attempts * 2))) } catch { break }
      }
    }
    loading = false
    presentation.reset()
    activity = AgentActivity(status: "idle")
    connectionState = "Disconnected"
  }

  func refreshInBackground(_ page: HistoryPage) -> Bool {
    let previous = messages
    merge(page, replacingInitial: !hasRefreshedHistory)
    return messages != previous
  }

  private static func connectionFailureMessage(_ error: Error) -> String {
    if let network = error as? URLError {
      switch network.code {
      case .timedOut: return "The server didn’t respond. Check Tailscale and the address."
      case .cannotFindHost, .dnsLookupFailed:
        return "Couldn’t find Pal. Check Tailscale and the address."
      case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
        .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
        return "Couldn’t establish a secure connection. Check Pal’s HTTPS address."
      case .notConnectedToInternet, .cannotConnectToHost, .networkConnectionLost:
        return "Couldn’t reach Pal. Check your connection and Tailscale."
      default: break
      }
    }
    if error is DecodingError { return "Pal returned an unreadable response." }
    if let chat = error as? ChatError { return chat.localizedDescription }
    return "Connection interrupted. Reconnecting…"
  }

  func loadEarlier() async {
    guard let before, !loading else { return }
    loading = true
    defer { loading = false }
    do {
      let page = try await service.history(before: before)
      mergeMessages(page.messages)
      historyPagination = HistoryPagination(before: page.before)
      reconcilePending()
      save()
    } catch { self.error = "Couldn’t load earlier messages." }
  }

  func send() async {
    guard !sending,
      pending != nil || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !attachmentIds.isEmpty
    else { return }
    if pending == nil {
      pending = MessageSubmission(
        idempotencyKey: UUID().uuidString, text: draft, taskId: taskId,
        replyToMessageId: nil, localAttachmentIds: attachmentIds, attachmentIds: [])
      persistPending()
      draft = ""
      attachmentIds = []
      presentation.submitted()
    }
    guard var submission = pending else { return }
    sending = true
    error = nil
    defer { sending = false }
    do {
      while submission.attachmentIds.count < submission.localAttachmentIds.count {
        try Task.checkCancellation()
        let localId = submission.localAttachmentIds[submission.attachmentIds.count]
        let uploaded = try await service.upload(
          images.drafts.data(localId), filename: "Photo.jpg")
        submission.attachmentIds.append(uploaded.id)
        pending = submission
        persistPending()
      }
      try await service.submit(submission)
      if pending?.idempotencyKey == submission.idempotencyKey {
        pendingAcknowledged = true
        persistPending()
      }
      do {
        let newestSequence = messages.last?.sequence ?? 0
        merge(
          try await service.history(before: nil), replacingInitial: false,
          liveAfter: connectionState == "Connected" ? newestSequence : nil)
      } catch { self.error = "Message sent. Reconnecting to load the conversation." }
    } catch ChatError.rejected(let status) where [400, 413].contains(status) {
      if pending?.idempotencyKey == submission.idempotencyKey {
        if !submission.text.isEmpty {
          draft = submission.text + (draft.isEmpty ? "" : "\n\n" + draft)
        }
        attachmentIds = submission.localAttachmentIds + attachmentIds
        clearPending(discardImages: false)
      }
      self.error = "The message was rejected. Edit it and try again."
    } catch {
      if pending != nil && !pendingAcknowledged {
        self.error = "Couldn’t confirm the send. Retry is safe and uses the same request."
      }
    }
  }

  func stageImage(_ bytes: Data) async {
    guard attachmentIds.count < 10, !sending, !hasPendingSend else { return }
    let id = UUID().uuidString
    do {
      try await images.drafts.save(bytes, id: id)
      localImageIds.insert(id)
      attachmentIds.append(id)
    } catch { self.error = "Couldn’t save that image. Select it again." }
  }

  func removeImage(_ id: String) {
    attachmentIds.removeAll { $0 == id }
    localImageIds.remove(id)
    images.drafts.remove(id)
    images.remove(id)
  }

  func image(_ id: String) async throws -> Data {
    if localImageIds.contains(id) { return try await images.drafts.data(id) }
    return try await service.attachment(id, download: false)
  }
  func cachedImage(_ id: String) -> UIImage? { images.cached(id) }
  func preparedImage(_ id: String) async throws -> UIImage {
    try await images.image(id) { try await self.image(id) }
  }
  func imagePreview(_ id: String) async throws -> ImagePreviewFile {
    try await images.preview(id) { try await self.image(id) }
  }
  func attachment(_ id: String) async throws -> Data {
    try await service.attachment(id, download: true)
  }
  func select(_ action: ChatMessage.Action, message: ChatMessage) async {}

  @discardableResult private func mergeMessages(
    _ incoming: [ChatMessage], liveAfter sequence: Int? = nil, presentAllNew: Bool = false
  ) -> Bool {
    var merged = messages
    var indices = Dictionary(uniqueKeysWithValues: merged.indices.map { (merged[$0].id, $0) })
    var changed = false
    for message in incoming where belongs(message) {
      if let index = indices[message.id] {
        guard message.version >= merged[index].version, message != merged[index] else { continue }
        merged[index] = message
      } else {
        let wasOptimistic = pending.map { $0.idempotencyKey == message.idempotencyKey } ?? false
        if (presentAllNew || sequence.map { message.sequence > $0 } == true) && !wasOptimistic {
          presentation.arrived(message)
        }
        indices[message.id] = merged.endIndex
        merged.append(message)
      }
      changed = true
    }
    guard changed else { return false }
    messages = merged.sorted { $0.sequence < $1.sequence }
    return true
  }
}
