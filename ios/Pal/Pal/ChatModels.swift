import Foundation

enum ConversationHistory { static let pageSize = 25 }

struct ChatMessage: Codable, Identifiable, Equatable, Sendable {
  struct Link: Codable, Equatable, Sendable {
    let label: String
    let url: String
  }
  struct Attachment: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let filename: String
    let contentType: String
    let sizeBytes: Int
    let createdAt: String
    var name: String { filename }
    var mimeType: String { contentType }
  }
  struct ReplySummary: Codable, Equatable, Sendable {
    let id: String
    let sequence: Int
    let role: String
    let textPreview: String
    let taskId: String?
    let phase: String?
    var mainVisible: Bool? = nil
  }

  let id: String
  let createdAt: String
  let updatedAt: String
  let version: Int
  let sequence: Int
  let idempotencyKey: String?
  let replyToMessageId: String?
  let replyTo: ReplySummary?
  let role: String
  let source: String?
  let text: String
  let attachments: [Attachment]
  let taskId: String?
  let phase: String?
  var mainVisible: Bool? = nil
  var reaction: String? = nil

  var format: String { role == "assistant" ? "markdown" : "plain" }
  var attachmentIds: [String] { attachments.map(\.id) }
  var links: [Link] { [] }
  var questionId: String? { nil }
  var displayRole: String { role == "user" ? "owner" : role }

  static func optimistic(_ submission: MessageSubmission) -> ChatMessage {
    ChatMessage(
      id: submission.optimisticId, createdAt: "", updatedAt: "", version: 0,
      sequence: Int.max, idempotencyKey: submission.idempotencyKey,
      replyToMessageId: submission.replyToMessageId, replyTo: nil, role: "user",
      source: "ios", text: submission.text,
      attachments: submission.localAttachmentIds.map {
        Attachment(
          id: $0, filename: "Photo.jpg", contentType: "image/jpeg", sizeBytes: 0,
          createdAt: "")
      },
      taskId: submission.taskId, phase: nil)
  }
}

struct AgentActivity: Codable, Equatable, Sendable {
  let status: String
  var state: String { status }
}

struct HistoryPage: Codable, Sendable {
  let messages: [ChatMessage]
  let before: Int?
}

struct MessageSubmission: Codable, Equatable, Sendable {
  let idempotencyKey: String
  let text: String
  let taskId: String?
  let replyToMessageId: String?
  let localAttachmentIds: [String]
  var attachmentIds: [String]
  var requestId: String { idempotencyKey }
  var optimisticId: String { "pending:" + idempotencyKey }
}

enum ChatUpdate: Sendable {
  case message(ChatMessage)
  case activity(AgentActivity)
  case task(OwnerTask)
  case heartbeat
}

struct ServerEvent: Equatable, Sendable {
  let name: String
  let id: String?
  let data: String
}

struct SSEParser: Sendable {
  private var name = "message"
  private var id: String?
  private var data: [String] = []
  mutating func consume(_ raw: String) -> ServerEvent? {
    let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
    if line.isEmpty {
      defer { name = "message"; id = nil; data = [] }
      return data.isEmpty
        ? nil : ServerEvent(name: name, id: id, data: data.joined(separator: "\n"))
    }
    if line.hasPrefix(":") { return nil }
    let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    var value = parts.count > 1 ? String(parts[1]) : ""
    if value.hasPrefix(" ") { value.removeFirst() }
    switch String(parts[0]) {
    case "event": name = value
    case "id": if !value.contains("\0") { id = value }
    case "data": data.append(value)
    default: break
    }
    return nil
  }
}

protocol ChatService: Sendable {
  func scoped(to taskId: String?) async -> any ChatService
  func setTaskArchived(_ id: String, archived: Bool) async throws
  func tasks(after: String?, archived: Bool) async throws -> OwnerTaskPage
  func taskDetail(_ id: String) async throws -> OwnerTask
  func history(before: Int?) async throws -> HistoryPage
  func submit(_ message: MessageSubmission) async throws
  func upload(_ data: Data, filename: String) async throws -> ChatMessage.Attachment
  func attachment(_ id: String, download: Bool) async throws -> Data
  func events() async throws -> AsyncThrowingStream<ChatUpdate, Error>
}

extension ChatService {
  func scoped(to taskId: String?) async -> any ChatService { self }
  func setTaskArchived(_ id: String, archived: Bool) async throws { throw ChatError.rejected(404) }
  func tasks(after: String?, archived: Bool) async throws -> OwnerTaskPage {
    OwnerTaskPage(tasks: [], after: nil)
  }
  func taskDetail(_ id: String) async throws -> OwnerTask { throw ChatError.rejected(404) }
  func attachment(_ id: String, download: Bool = false) async throws -> Data {
    throw ChatError.rejected(404)
  }
}
