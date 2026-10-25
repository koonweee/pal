import SwiftUI

private enum ChatPreviewData {
  @MainActor static func store() -> ConversationStore {
    let defaults = UserDefaults(suiteName: "pal.native.preview." + UUID().uuidString)!
    let store = ConversationStore(service: FixtureChatService(), defaults: defaults)
    let samples = [
      ("user", "Could you take a look at these?"),
      (
        "assistant",
        "**Here’s what I found.** This text supports *emphasis*, ~~corrections~~ and [links](https://example.com).\n\n"
          + String(
            repeating: "A longer response should stay readable with system text styles. ", count: 5)
      ),
      ("assistant", "The result is ready."),
    ]
    for (index, sample) in samples.enumerated() {
      store.apply(
        .message(
          ChatMessage(
            id: "sample-\(index)", createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z", version: 1,
            sequence: index + 1, idempotencyKey: nil, replyToMessageId: nil,
            replyTo: nil, role: sample.0, source: sample.0 == "user" ? "ios" : nil,
            text: sample.1, attachments: [], taskId: nil,
            phase: sample.0 == "assistant" ? "final_answer" : nil)))
    }
    return store
  }
}

#Preview("Conversation") {
  NavigationStack { ChatScreen(store: ChatPreviewData.store()).navigationTitle("Pal") }
}
#Preview("Dark large text") {
  NavigationStack { ChatScreen(store: ChatPreviewData.store()).navigationTitle("Pal") }
    .preferredColorScheme(.dark).environment(\.dynamicTypeSize, .accessibility2)
}
#Preview("Recovery composer") {
  let store = ChatPreviewData.store()
  store.draft = "A saved draft"
  store.error = "Couldn’t confirm the send. Retry is safe and uses the same request."
  return NavigationStack { ChatScreen(store: store).navigationTitle("Pal") }
}
#Preview("Sending owner message") {
  let defaults = UserDefaults(suiteName: "pal.native.preview." + UUID().uuidString)!
  let store = ConversationStore(service: FixtureChatService(slowSend: true), defaults: defaults)
  store.draft = "Move this into the conversation immediately."
  return NavigationStack { ChatScreen(store: store) }.task { await store.send() }
}
#Preview("Markdown blocks") {
  ScrollView { MessageText(text: FixtureChatService.markdownDemo, format: "markdown").padding() }
}

#Preview("Attachment composer") {
  let store = ChatPreviewData.store()
  store.draft = "Take a look at this image."
  return NavigationStack { ChatScreen(store: store) }
    .task {
      await store.stageImage(FixtureChatService.fixtureImageData())
    }
}
