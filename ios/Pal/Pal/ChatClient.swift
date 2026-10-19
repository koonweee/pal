import Foundation

struct ChatConnection: Sendable {
  let url: URL
  init(address: String) throws {
    guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
      let host = url.host, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/"
    else { throw ChatError.invalidConnection }
    let privateHTTPS = url.scheme == "https"
    #if DEBUG
      let loopback = url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)
    #else
      let loopback = false
    #endif
    guard privateHTTPS || loopback else { throw ChatError.invalidConnection }
    self.url = url
  }
}

enum ChatError: LocalizedError {
  case invalidConnection
  case rejected(Int)
  case disconnected
  var errorDescription: String? {
    switch self {
    case .invalidConnection: "Enter your private HTTPS Pal address."
    case .rejected(409): "This request has already changed. Refresh and try again."
    case .rejected: "Pal couldn’t accept this request."
    case .disconnected: "Connection interrupted. Your conversation is saved."
    }
  }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

actor ChatClient: ChatService {
  private static let contractVersion = "3"
  private let connection: ChatConnection
  private let taskId: String?
  private let session: URLSession

  init(
    connection: ChatConnection, taskId: String? = nil,
    configuration: URLSessionConfiguration = .ephemeral, timeout: TimeInterval = 86_400
  ) {
    self.connection = connection
    self.taskId = taskId
    let config = configuration
    config.timeoutIntervalForRequest = min(45, timeout)
    config.timeoutIntervalForResource = timeout
    session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
  }

  func scoped(to taskId: String?) async -> any ChatService {
    ChatClient(connection: connection, taskId: taskId)
  }

  private func request(
    _ path: String, method: String = "GET", body: Data? = nil,
    contentType: String = "application/json"
  ) -> URLRequest {
    var result = URLRequest(url: URL(string: path, relativeTo: connection.url)!.absoluteURL)
    result.httpMethod = method
    result.setValue(contentType, forHTTPHeaderField: "Content-Type")
    result.setValue(Self.contractVersion, forHTTPHeaderField: "X-Pal-Contract-Version")
    result.httpBody = body
    return result
  }

  private func checked(_ response: URLResponse) throws {
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
      throw ChatError.rejected((response as? HTTPURLResponse)?.statusCode ?? 0)
    }
  }

  private func data(_ request: URLRequest) async throws -> Data {
    let (data, response) = try await session.data(for: request)
    try checked(response)
    return data
  }

  func history(before: Int? = nil) async throws -> HistoryPage {
    var components = URLComponents()
    components.path = "/chat/history"
    components.queryItems = [URLQueryItem(name: "limit", value: String(ConversationHistory.pageSize))]
    if let taskId { components.queryItems?.append(URLQueryItem(name: "taskId", value: taskId)) }
    if let before { components.queryItems?.append(URLQueryItem(name: "before", value: String(before))) }
    return try JSONDecoder().decode(
      HistoryPage.self, from: await data(request(components.string!)))
  }

  func submit(_ message: MessageSubmission) async throws {
    struct Payload: Encodable {
      let idempotencyKey: String
      let destinationId: String
      let taskId: String?
      let replyToMessageId: String?
      let text: String
      let metadata: [String: String]
      let attachmentIds: [String]
    }
    let timezone = TimeZone.current.identifier
    let payload = Payload(
      idempotencyKey: message.idempotencyKey, destinationId: "ios", taskId: taskId,
      replyToMessageId: message.replyToMessageId, text: message.text,
      metadata: ["timezone": timezone], attachmentIds: message.attachmentIds)
    _ = try await data(
      request("/chat/messages", method: "POST", body: JSONEncoder().encode(payload)))
  }

  func upload(_ bytes: Data, filename: String) async throws -> ChatMessage.Attachment {
    let boundary = "Pal-" + UUID().uuidString
    var body = Data()
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".utf8))
    body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
    body.append(bytes)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    struct Response: Decodable { let attachment: ChatMessage.Attachment }
    return try JSONDecoder().decode(
      Response.self,
      from: await data(
        request(
          "/files", method: "POST", body: body,
          contentType: "multipart/form-data; boundary=\(boundary)")))
      .attachment
  }

  func attachment(_ id: String, download: Bool = false) async throws -> Data {
    guard UUID(uuidString: id) != nil else { throw ChatError.rejected(400) }
    return try await data(request("/files/\(id)/\(download ? "download" : "content")"))
  }

  func tasks(after: String?, archived: Bool) async throws -> OwnerTaskPage {
    var components = URLComponents()
    components.path = "/tasks"
    components.queryItems = [
      URLQueryItem(name: "limit", value: "100"),
      URLQueryItem(name: "archived", value: archived ? "true" : "false"),
    ]
    if let after { components.queryItems?.append(URLQueryItem(name: "after", value: after)) }
    return try JSONDecoder().decode(
      OwnerTaskPage.self, from: await data(request(components.string!)))
  }

  func taskDetail(_ id: String) async throws -> OwnerTask {
    guard UUID(uuidString: id) != nil else { throw ChatError.rejected(400) }
    let response = try JSONDecoder().decode(
      OwnerTaskDetailResponse.self,
      from: await data(request("/tasks/details/\(id)")))
    return response.task
  }

  func setTaskArchived(_ id: String, archived: Bool) async throws {
    guard UUID(uuidString: id) != nil else { throw ChatError.rejected(400) }
    _ = try await data(
      request(
        "/tasks/\(id)/archive", method: "POST",
        body: JSONEncoder().encode(["archived": archived])))
  }

  func registerPush(id: String, token: String, environment: String) async throws {
    struct Registration: Encodable { let token: String; let environment: String }
    _ = try await data(
      request(
        "/notifications/ios/installations/\(id)", method: "PUT",
        body: JSONEncoder().encode(Registration(token: token, environment: environment))))
  }

  func removePushRegistration(_ id: String) async throws {
    _ = try await data(request("/notifications/ios/installations/\(id)", method: "DELETE"))
  }

  func events() async throws -> AsyncThrowingStream<ChatUpdate, Error> {
    var streamRequest = request("/stream")
    streamRequest.timeoutInterval = 86_400
    streamRequest.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    let (bytes, response) = try await session.bytes(for: streamRequest)
    try checked(response)
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          var parser = SSEParser()
          var lineBytes: [UInt8] = []
          for try await byte in bytes {
            try Task.checkCancellation()
            if byte != 10 {
              lineBytes.append(byte)
              if lineBytes.count > 1_000_000 { throw ChatError.disconnected }
              continue
            }
            let line = String(decoding: lineBytes, as: UTF8.self)
            lineBytes.removeAll(keepingCapacity: true)
            guard let event = parser.consume(line), let encoded = event.data.data(using: .utf8)
            else { continue }
            switch event.name {
            case "message.added", "message.updated":
              struct Envelope: Decodable { let message: ChatMessage }
              continuation.yield(.message(try JSONDecoder().decode(Envelope.self, from: encoded).message))
            case "agent.activity":
              struct Envelope: Decodable { let state: AgentActivity }
              continuation.yield(.activity(try JSONDecoder().decode(Envelope.self, from: encoded).state))
            case "task.added", "task.updated":
              struct Envelope: Decodable { let task: OwnerTask }
              continuation.yield(.task(try JSONDecoder().decode(Envelope.self, from: encoded).task))
            case "heartbeat": continuation.yield(.heartbeat)
            default: break
            }
          }
          continuation.finish(throwing: ChatError.disconnected)
        } catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
