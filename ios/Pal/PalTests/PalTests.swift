import Foundation
import Testing

@testable import Pal

@Test func decodesPalMessageAndAttachment() throws {
  let data = Data(
    #"{"id":"11111111-1111-4111-8111-111111111111","createdAt":"2026-10-10T00:00:00.000Z","updatedAt":"2026-10-10T00:00:00.000Z","version":2,"mainVisible":false,"reaction":"👀","sequence":7,"idempotencyKey":"request-1","replyToMessageId":null,"replyTo":null,"role":"user","source":"ios","text":"hello","attachments":[{"id":"22222222-2222-4222-8222-222222222222","createdAt":"2026-10-10T00:00:00.000Z","filename":"photo.jpg","contentType":"image/jpeg","sizeBytes":12}],"suggestedReplies":[],"taskId":null,"phase":null}"#
      .utf8)
  let message = try JSONDecoder().decode(ChatMessage.self, from: data)
  #expect(message.version == 2)
  #expect(message.reaction == "👀")
  #expect(message.mainVisible == false)
  #expect(message.displayRole == "owner")
  #expect(message.attachmentIds == ["22222222-2222-4222-8222-222222222222"])
}

@Test func eventParserPreservesBoundariesAndMultilineData() {
  var parser = SSEParser()
  #expect(parser.consume("event: message.added") == nil)
  #expect(parser.consume("data: {\"one\":") == nil)
  #expect(parser.consume("data: 1}") == nil)
  #expect(
    parser.consume("")
      == ServerEvent(name: "message.added", id: nil, data: "{\"one\":\n1}"))
}

@Test @MainActor func optimisticMessageReconcilesByIdempotencyKey() async {
  let suite = "pal.native.tests." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let service = FixtureChatService()
  let store = ConversationStore(service: service, defaults: defaults)
  store.draft = "hello"
  await store.send()
  #expect(store.displayedMessages.filter { $0.text == "hello" }.count == 1)
  #expect(store.hasPendingSend == false)
  #expect(store.latestReadMessageID == store.messages.last(where: { $0.role == "user" })?.id)
}

@Test @MainActor func readReceiptTracksOnlyLatestPersistedUserMessage() async {
  let suite = "pal.native.read-receipt." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let store = ConversationStore(service: FixtureChatService(), defaults: defaults)

  store.draft = "first"
  await store.send()
  let first = store.latestReadMessageID
  store.draft = "second"
  await store.send()

  #expect(first != nil)
  #expect(store.latestReadMessageID != first)
  #expect(store.messages.filter { $0.id == store.latestReadMessageID }.count == 1)
  #expect(store.messages.first { $0.id == store.latestReadMessageID }?.text == "second")
}

@Test @MainActor func acknowledgedSendDoesNotOfferRetryWhileAwaitingReconciliation() async {
  let suite = "pal.native.acknowledged-send." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let store = ConversationStore(
    service: FixtureChatService(historyFailsAfterSubmission: true), defaults: defaults)
  store.draft = "hello"

  await store.send()

  #expect(store.hasPendingSend)
  #expect(store.pendingAcknowledged)
  #expect(!store.needsSendRetry)
  #expect(store.isAwaitingSendReconciliation)
  #expect(store.latestReadMessageID == nil)
  #expect(store.error == "Message sent. Reconnecting to load the conversation.")
}

@Test @MainActor func initialHistorySortsOldestFirst() {
  let suite = "pal.native.tests." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let store = ConversationStore(service: FixtureChatService(), defaults: defaults)
  let message: (Int) -> ChatMessage = { sequence in
    ChatMessage(
      id: "message-\(sequence)", createdAt: "", updatedAt: "", version: 1,
      sequence: sequence, idempotencyKey: nil, replyToMessageId: nil, replyTo: nil,
      role: "assistant", source: nil, text: "message \(sequence)", attachments: [],
      taskId: nil, phase: "final_answer")
  }

  _ = store.refreshInBackground(
    HistoryPage(messages: [message(3), message(2), message(1)], before: nil))

  #expect(store.messages.map(\.sequence) == [1, 2, 3])
}

@Test @MainActor func tasksSortByLatestActivity() {
  let store = OwnerTasksStore(service: FixtureChatService())
  let task: (String, Int, String) -> OwnerTask = { id, version, activity in
    OwnerTask(
      id: id, createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z", version: version,
      lastActivityAt: activity, title: id, goal: id, status: "in-progress",
      archived: false, description: nil)
  }
  store.apply(task("older", 1, "2026-10-10T00:00:00.000Z"))
  store.apply(task("newer", 1, "2026-10-10T01:00:00.000Z"))
  #expect(store.tasks.map(\.id) == ["newer", "older"])

  store.apply(task("older", 2, "2026-10-10T02:00:00.000Z"))
  #expect(store.tasks.map(\.id) == ["older", "newer"])
}

@Test func connectionRejectsCredentialsAndNonTLSRemoteAddresses() throws {
  #expect(throws: ChatError.self) { try ChatConnection(address: "https://user:secret@example.com") }
  #expect(throws: ChatError.self) { try ChatConnection(address: "http://example.com") }
  _ = try ChatConnection(address: "https://pal.example.com")
}

@Test @MainActor func earlierHistoryMergesInOrderWithoutDuplicates() async throws {
  let suite = "pal.native.pagination." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let service = FixtureChatService(paginated: true)
  let store = ConversationStore(service: service, defaults: defaults)
  _ = store.refreshInBackground(try await service.history(before: nil))

  await store.loadEarlier()

  #expect(store.messages.count == 50)
  #expect(store.messages.map(\.sequence) == store.messages.map(\.sequence).sorted())
  #expect(Set(store.messages.map(\.id)).count == store.messages.count)
}

@Test @MainActor func liveAssistantWithoutRequestKeyUsesArrivalPresentation() {
  let suite = "pal.native.arrival." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let store = ConversationStore(service: FixtureChatService(), defaults: defaults)
  let message = ChatMessage(
    id: "assistant-reply", createdAt: "", updatedAt: "", version: 1,
    sequence: 1, idempotencyKey: nil, replyToMessageId: nil, replyTo: nil,
    role: "assistant", source: nil, text: "Hello", attachments: [],
    taskId: nil, phase: "final_answer")

  store.apply(.message(message), live: true)

  #expect(store.presentation.pendingMessageIDs == [message.id])
  #expect(store.presentation.leadInDuration != nil)
  store.presentation.reveal()
  #expect(store.presentation.pendingMessageIDs.isEmpty)
  let revision = store.presentation.revision
  store.apply(.message(message), live: true)
  #expect(store.presentation.revision == revision)
}
