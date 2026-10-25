import QuickLook
import SwiftUI

struct MessageRow: View {
  let message: ChatMessage
  let store: ConversationStore
  var showsReadReceipt = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @ScaledMetric(relativeTo: .title2) private var reactionInset: CGFloat = 20
  @State private var previewURL: URL?
  @State private var previewFiles: [ImagePreviewFile] = []
  @State private var preparingImage: String?
  @State private var previewFailed = false
  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      HStack(alignment: .bottom) {
        if message.displayRole == "owner" { Spacer(minLength: 36) }
        VStack(alignment: .leading, spacing: PalTheme.spacing) {
          if !message.text.isEmpty {
            MessageText(text: message.text, format: message.format)
          }
          if imageIds.count == 1 {
            imageButton(imageIds[0], square: false)
          } else if !imageIds.isEmpty {
            let columns = imageIds.count <= 4 ? 2 : 3
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
              ForEach(0..<((imageIds.count + columns - 1) / columns), id: \.self) { row in
                GridRow {
                  ForEach(0..<columns, id: \.self) { column in
                    let index = row * columns + column
                    if index < imageIds.count {
                      imageButton(imageIds[index], square: true)
                    } else {
                      Color.clear.aspectRatio(1, contentMode: .fit).accessibilityHidden(true)
                    }
                  }
                }
              }
            }
            .frame(maxWidth: .infinity)
          }
          ForEach(message.attachmentIds, id: \.self) { id in
            if let attachment = message.attachments.first(where: { $0.id == id }),
              !attachment.mimeType.hasPrefix("image/")
            {
              ChatDocument(attachment: attachment, store: store)
            }
          }
          MessageLinks(message: message)
        }
        .padding(PalTheme.spacing)
        .background(
          message.displayRole == "owner"
            ? Color.accentColor.opacity(0.12) : PalTheme.assistantBackground,
          in: .rect(cornerRadius: PalTheme.messageRadius)
        )
        .overlay(alignment: .topLeading) {
          if let reaction = message.reaction {
            Text(reaction)
              .font(.title2)
              .padding(6)
              .background(message.displayRole == "owner" ? Color.accentColor : PalTheme.assistantBackground, in: .circle)
              .overlay(Circle().stroke(PalTheme.contentBackground, lineWidth: 3))
              .offset(x: -10, y: -reactionInset)
              .accessibilityLabel("Pal reacted \(reaction)")
          }
        }
        .padding(.top, message.reaction == nil ? 0 : reactionInset)
        .overlay {
          if isPending && store.sending && !reduceMotion && !reduceTransparency {
            SendingShimmer()
          }
        }
        .opacity(isPending && !reduceTransparency ? PalTheme.sendingOpacity : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: isPending)
        if message.displayRole != "owner" { Spacer(minLength: 36) }
      }
      if showsReadReceipt {
        MessageReadReceipt(createdAt: message.createdAt).padding(.trailing, PalTheme.spacing)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(message.displayRole == "owner" ? "You" : "Pal")
    .accessibilityValue(isPending ? (store.sending ? "Sending" : "Send unconfirmed") : "")
    .quickLookPreview($previewURL, in: previewFiles.map(\.url))
    .onChange(of: previewURL) { _, url in
      if url == nil { previewFiles = [] }
    }
    .alert("Image unavailable", isPresented: $previewFailed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("The image could not be opened. Try again.")
    }
  }

  private var imageIds: [String] {
    message.attachmentIds.filter { id in
      message.attachments.first(where: { $0.id == id })?.mimeType.hasPrefix("image/") ?? true
    }
  }

  private func imageButton(_ id: String, square: Bool) -> some View {
    Button {
      openImage(id)
    } label: {
      ChatImage(id: id, store: store, square: square)
        .overlay {
          if preparingImage == id { ProgressView().accessibilityLabel("Opening image") }
        }
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("Open image")
    .accessibilityLabel("Open image")
    .accessibilityValue("\((imageIds.firstIndex(of: id) ?? 0) + 1) of \(imageIds.count)")
    .disabled(preparingImage != nil)
  }

  private func openImage(_ id: String) {
    preparingImage = id
    Task {
      defer { preparingImage = nil }
      do {
        let ids = imageIds
        var files: [ImagePreviewFile] = []
        for candidate in ids { files.append(try await store.imagePreview(candidate)) }
        guard let index = ids.firstIndex(of: id) else { return }
        previewFiles = files
        previewURL = files[index].url
      } catch { previewFailed = true }
    }
  }
  private var isPending: Bool {
    message.id == store.optimisticMessage?.id && !store.pendingAcknowledged
  }
}

private struct MessageReadReceipt: View {
  let createdAt: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var visible = false

  private var date: Date? {
    try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(createdAt)
  }

  var body: some View {
    if let date {
      Text("Read \(date, format: .dateTime.hour().minute())")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .opacity(visible ? 1 : 0)
        .offset(y: visible || reduceMotion ? 0 : 2)
        .accessibilityLabel(Text("Read at \(date, format: .dateTime.hour().minute())"))
        .accessibilityIdentifier("messageReadReceipt")
        .onAppear {
          withAnimation(.easeOut(duration: 0.18)) { visible = true }
        }
    }
  }
}

private struct SendingShimmer: View {
  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
      let progress =
        context.date.timeIntervalSinceReferenceDate
        .truncatingRemainder(dividingBy: 2.4) / 2.4
      GeometryReader { geometry in
        LinearGradient(
          colors: [.clear, Color.primary.opacity(0.06), .clear],
          startPoint: .leading, endPoint: .trailing
        )
        .offset(x: geometry.size.width * (progress * 2 - 1))
      }
      .clipShape(.rect(cornerRadius: PalTheme.messageRadius))
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
struct MessageLinks: View {
  let message: ChatMessage
  var body: some View {
    ForEach(message.links, id: \.url) { link in
      if let url = URL(string: link.url), ["https", "http"].contains(url.scheme ?? "") {
        Link(link.label, destination: url).buttonStyle(.bordered)
      }
    }
  }
}
struct ChatImage: View {
  let id: String
  let store: ConversationStore
  var square = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var image: UIImage?
  @State private var failed = false
  var body: some View {
    // Reserve the same area before and after decoding; retain the full single image.
    Group {
      if square {
        Color.clear.aspectRatio(1, contentMode: .fit)
      } else {
        Color.clear.frame(height: 240)
      }
    }
    .overlay { content }
    .clipShape(.rect(cornerRadius: square ? 8 : 12))
    .task(id: id) {
      image = nil
      failed = false
      do {
        let loaded = try await store.preparedImage(id)
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
          image = loaded
        }
      } catch { failed = true }
    }
  }
  @ViewBuilder private var content: some View {
    if let image = image ?? store.cachedImage(id) {
      Image(uiImage: image).resizable()
        .aspectRatio(contentMode: square ? .fill : .fit)
        .accessibilityLabel("Attached image")
        .transition(.opacity)
    } else if failed {
      Image(systemName: "photo.badge.exclamationmark")
        .accessibilityLabel("Image unavailable")
    } else {
      ProgressView().transition(.opacity)
    }
  }
}

struct ChatDocument: View {
  let attachment: ChatMessage.Attachment
  let store: ConversationStore
  @State private var preview: DocumentSelection?
  @State private var directory: URL?
  @State private var loading = false
  @State private var failed = false
  var body: some View {
    VStack {
      Button {
        loading = true
        Task {
          do {
            let data = try await store.attachment(attachment.id)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
              UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            directory = folder
            let name = (attachment.name as NSString).lastPathComponent
            let url = folder.appendingPathComponent(
              name.isEmpty || name == "." || name == ".." ? "Attachment" : name)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            preview = DocumentSelection(url: url)
          } catch {
            cleanup()
            failed = true
          }
          loading = false
        }
      } label: {
        HStack {
          Label(attachment.name, systemImage: "doc")
          if loading { ProgressView() }
        }
      }
      .buttonStyle(.bordered)
      .controlSize(.large)
      .tint(Color(uiColor: .label))
      .disabled(loading)
      .accessibilityLabel("Open document: " + attachment.name)
    }
    .sheet(item: $preview, onDismiss: cleanup) { selection in
      NavigationStack {
        NativeDocumentPreview(url: selection.url)
          .navigationTitle(attachment.name)
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button("Done", systemImage: "xmark") { preview = nil }
                .labelStyle(.iconOnly).accessibilityLabel("Close document")
            }
            ToolbarItem(placement: .bottomBar) {
              ShareLink(item: selection.url)
            }
          }
      }
    }
    .alert("Document unavailable", isPresented: $failed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("The document could not be opened. Try again.")
    }
  }
  private func cleanup() {
    if let directory { try? FileManager.default.removeItem(at: directory) }
    directory = nil
  }
}

private struct DocumentSelection: Identifiable {
  let url: URL
  var id: URL { url }
}

private struct NativeDocumentPreview: UIViewControllerRepresentable {
  let url: URL
  func makeCoordinator() -> Coordinator { Coordinator(url: url) }
  func makeUIViewController(context: Context) -> QLPreviewController {
    let controller = QLPreviewController()
    controller.dataSource = context.coordinator
    return controller
  }
  func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
  final class Coordinator: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int)
      -> QLPreviewItem
    {
      url as NSURL
    }
  }
}
