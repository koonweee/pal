import Foundation
import UIKit

/** Explicit preview/UI-test fixtures. They never connect to Pal or external providers. */
actor FixtureChatService: ChatService {
  static let markdownDemo = """
    # Trip notes

    Here is **structured Markdown** with a [link](https://example.com).

    - One item
    - Another item

    ```swift
    let greeting = "Hello, Pal"
    ```
    """

  static let richMarkdownDemo = """
    # Rich Markdown

    > Structured content remains native and accessible.

    Use an [example link](https://example.com) alongside a task list:

    - [x] Preserve formatting
    - [ ] Keep scrolling smooth

    | Renderer | Status |
    | --- | --- |
    | MarkdownUI | Virtualized |

    ```swift
    let answer = 42
    ```

    ![Remote content](https://example.com/remote.png)
    """

  private var messages: [ChatMessage]
  private var tasksFixture: [OwnerTask]
  private var streams: [UUID: AsyncThrowingStream<ChatUpdate, Error>.Continuation] = [:]
  private var rejectNextSubmission: Bool
  private let submissionDelay: Duration
  private let scopeTaskId: String?
  private let unpagedHistory: Bool
  private let historyFailsAfterSubmission: Bool
  private var hasSubmitted = false

  init(
    document: Bool = false, rich: Bool = false, scrolling: Bool = false,
    performance: Bool = false,
    stagedReply: Bool = false, markdown: Bool = false, paginated: Bool = false,
    slowSend: Bool = false, rejectSend: Bool = false, ownerTasks: Bool = false,
    emptyTaskDetails: Bool = false, persistenceKey: String? = nil, imageCount: Int = 0,
    imageRole: String = "assistant", mixedImages: Bool = false, scopeTaskId: String? = nil,
    historyFailsAfterSubmission: Bool = false
  ) {
    self.scopeTaskId = scopeTaskId
    unpagedHistory = performance
    self.historyFailsAfterSubmission = historyFailsAfterSubmission
    rejectNextSubmission = rejectSend
    submissionDelay = slowSend ? .seconds(6) : (stagedReply ? .seconds(2) : .zero)
    let baseText =
      rich
      ? Self.richMarkdownDemo
      : markdown
        ? Self.markdownDemo : "Welcome to Pal. **One ongoing conversation**, with your assistant."
    messages = [Self.message(id: "welcome", role: "assistant", text: baseText, sequence: 1)]
    if scrolling || paginated || performance {
      let markdownHistory = markdown && scrolling
      let structuredHistory = performance || paginated
      messages += (2...(performance ? 200 : 80)).map {
        Self.message(
          id: "history-\($0)",
          role: markdownHistory ? "assistant" : ($0.isMultiple(of: 2) ? "assistant" : "user"),
          text: Self.historyText(
            sequence: $0, markdown: markdownHistory, structured: structuredHistory),
          sequence: $0)
      }
    }
    if document {
      messages.append(
        Self.message(id: "document", role: "assistant", text: "Document ready.", sequence: 100))
    }
    if imageCount > 0 {
      let attachments = (0..<imageCount).map { index in
        ChatMessage.Attachment(
          id: UUID().uuidString, filename: "Preview-\(index).png", contentType: "image/png",
          sizeBytes: 0, createdAt: "2026-10-10T00:00:00.000Z")
      }
      messages.append(
        Self.message(
          id: "image-preview", role: imageRole == "owner" ? "user" : "assistant",
          text: "Image preview", sequence: 101, attachments: attachments))
    }
    let taskId = "11111111-1111-4111-8111-111111111111"
    tasksFixture =
      ownerTasks
      ? [
        OwnerTask(
          id: taskId, createdAt: "2026-10-10T00:00:00.000Z",
          updatedAt: "2026-10-10T00:00:00.000Z", version: 1,
          lastActivityAt: "2026-10-10T00:00:00.000Z",
          title: "Plan the trip", goal: "Prepare a useful itinerary",
          status: "in-progress", archived: false,
          description: emptyTaskDetails ? nil : "Compare options and keep the plan current.")
      ] : []
  }

  private static func message(
    id: String, role: String, text: String, sequence: Int, idempotencyKey: String? = nil,
    taskId: String? = nil, attachments: [ChatMessage.Attachment] = []
  ) -> ChatMessage {
    ChatMessage(
      id: id, createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z", version: 1, sequence: sequence,
      idempotencyKey: idempotencyKey, replyToMessageId: nil, replyTo: nil, role: role,
      source: role == "user" ? "ios" : nil, text: text, attachments: attachments,
      taskId: taskId, phase: role == "assistant" ? "final_answer" : nil)
  }

  private static func historyText(
    sequence: Int, markdown: Bool, structured: Bool
  ) -> String {
    if markdown {
      let paragraph =
        "A saved message with **important detail** in your ongoing conversation.\n\n"
      return """
        ## History item \(sequence)

        \(String(repeating: paragraph, count: 1 + sequence % 4))
        - First point
        - Second point
        """
    }
    if structured && sequence.isMultiple(of: 2) {
      return """
        ## Fixture message \(sequence)

        **Structured history** stays readable while the conversation scrolls.

        - First measured item
        - Second measured item
        """
    }
    return "Fixture message \(sequence). "
      + String(repeating: "Readable history. ", count: sequence % 4)
  }

  func scoped(to taskId: String?) async -> any ChatService {
    FixtureChatService(ownerTasks: !tasksFixture.isEmpty, scopeTaskId: taskId)
  }

  func history(before: Int?) async throws -> HistoryPage {
    if historyFailsAfterSubmission && hasSubmitted { throw URLError(.networkConnectionLost) }
    let visible = messages.filter { message in
      if let scopeTaskId { return message.taskId == scopeTaskId }
      return message.taskId == nil
        || message.mainVisible == true
    }
    let eligible = before.map { cursor in visible.filter { $0.sequence < cursor } } ?? visible
    let page =
      unpagedHistory ? eligible : Array(eligible.suffix(ConversationHistory.pageSize))
    return HistoryPage(
      messages: page, before: eligible.count > page.count ? page.first?.sequence : nil)
  }

  func submit(_ submission: MessageSubmission) async throws {
    if rejectNextSubmission {
      rejectNextSubmission = false
      throw ChatError.rejected(400)
    }
    if submissionDelay != .zero { try await Task.sleep(for: submissionDelay) }
    guard !messages.contains(where: { $0.idempotencyKey == submission.idempotencyKey }) else {
      return
    }
    let user = Self.message(
      id: UUID().uuidString, role: "user", text: submission.text,
      sequence: (messages.map(\.sequence).max() ?? 0) + 1,
      idempotencyKey: submission.idempotencyKey, taskId: submission.taskId ?? scopeTaskId)
    messages.append(user)
    hasSubmitted = true
    yield(.message(user))
    let reply = Self.message(
      id: UUID().uuidString, role: "assistant", text: "Fixture reply from Pal.",
      sequence: user.sequence + 1, taskId: submission.taskId ?? scopeTaskId)
    messages.append(reply)
    yield(.message(reply))
  }

  func upload(_ data: Data, filename: String) async throws -> ChatMessage.Attachment {
    ChatMessage.Attachment(
      id: UUID().uuidString, filename: filename, contentType: "image/jpeg",
      sizeBytes: data.count, createdAt: "2026-10-10T00:00:00.000Z")
  }

  func attachment(_ id: String, download: Bool) async throws -> Data {
    try await Task.sleep(for: .seconds(4))
    return await Self.fixtureImageData()
  }

  @MainActor static func fixtureImageData() -> Data {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 320, height: 240))
    return renderer.pngData { context in
      UIColor.systemBackground.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 320, height: 240))
      UIColor.systemBlue.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 80, y: 40, width: 160, height: 160))
      UIColor.systemBackground.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 125, y: 85, width: 70, height: 70))
    }
  }

  func tasks(after: String?, archived: Bool) async throws -> OwnerTaskPage {
    OwnerTaskPage(tasks: tasksFixture.filter { $0.archived == archived }, after: nil)
  }

  func taskDetail(_ id: String) async throws -> OwnerTask {
    guard let task = tasksFixture.first(where: { $0.id == id }) else {
      throw ChatError.rejected(404)
    }
    return task
  }

  func setTaskArchived(_ id: String, archived: Bool) async throws {
    guard let index = tasksFixture.firstIndex(where: { $0.id == id }) else {
      throw ChatError.rejected(404)
    }
    tasksFixture[index].archived = archived
    yield(.task(tasksFixture[index]))
  }

  func events() async throws -> AsyncThrowingStream<ChatUpdate, Error> {
    AsyncThrowingStream { continuation in
      let id = UUID()
      streams[id] = continuation
      continuation.yield(.activity(AgentActivity(status: "idle")))
      continuation.onTermination = { _ in Task { await self.removeStream(id) } }
    }
  }

  private func yield(_ update: ChatUpdate) {
    for continuation in streams.values { continuation.yield(update) }
  }

  private func removeStream(_ id: UUID) { streams[id] = nil }
}
