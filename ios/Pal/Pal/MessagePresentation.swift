import Foundation
import Observation

/// Ephemeral presentation only. Canonical messages and their cursor are saved before any reveal.
@MainActor @Observable final class MessagePresentation {
  private(set) var pendingMessageIDs: Set<String> = []
  private(set) var leadInDuration: Duration?
  private(set) var revision = 0
  private let delay: () -> Duration

  init(delay: @escaping () -> Duration = { .milliseconds(120) }) {
    self.delay = delay
  }

  func arrived(_ message: ChatMessage) {
    if message.role == "assistant" {
      pendingMessageIDs.insert(message.id)
      // A burst shares one lead-in; receiving another message never extends it.
      if leadInDuration == nil {
        leadInDuration = delay()
        revision += 1
      }
    } else {
      submitted()
    }
  }

  func submitted() { revision += 1 }

  func reveal() {
    guard leadInDuration != nil else { return }
    pendingMessageIDs.removeAll()
    leadInDuration = nil
    revision += 1
  }

  func reset() {
    pendingMessageIDs.removeAll()
    leadInDuration = nil
  }
}
