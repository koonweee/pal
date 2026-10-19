import Foundation

struct OwnerTask: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let createdAt: String
  let updatedAt: String
  let version: Int
  let lastActivityAt: String
  let title: String
  let goal: String
  let status: String
  var archived: Bool
  var description: String?

  var statusLabel: String { Self.label(status) }
  static func label(_ status: String) -> String {
    switch status {
    case "in-progress": "In progress"
    case "needs-input": "Needs input"
    case "completed": "Completed"
    default: "Unknown"
    }
  }
}

struct OwnerTaskPage: Codable, Sendable {
  let tasks: [OwnerTask]
  let after: String?
}

struct OwnerTaskDetailResponse: Codable, Sendable {
  let task: OwnerTask
}
