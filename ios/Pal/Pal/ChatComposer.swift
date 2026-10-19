import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ChatComposer: View {
  @Bindable var store: ConversationStore
  var focused: FocusState<Bool>.Binding
  @Binding var selectedTab: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var photos: [PhotosPickerItem] = []
  @State private var preparingPhotos = false
  var body: some View {
    VStack(spacing: 8) {
      if !store.attachmentIds.isEmpty {
        ScrollView(.horizontal) {
          HStack {
            ForEach(store.attachmentIds, id: \.self) { id in
              VStack {
                ChatImage(id: id, store: store).frame(width: 64, height: 64).clipped()
                Button("Remove", systemImage: "xmark.circle") { store.removeImage(id) }.labelStyle(
                  .iconOnly)
              }
              .transition(.opacity)
            }
          }.padding(.horizontal)
        }
        .transition(.opacity)
      }
      HStack(alignment: .bottom, spacing: 0) {
        if !focused.wrappedValue {
          PalNavigationMenu(selection: $selectedTab)
            .padding(.trailing, 8)
            .transition(.opacity)
        }
        HStack(alignment: .center, spacing: 8) {
          PhotosPicker(
            selection: $photos, maxSelectionCount: max(1, 10 - store.attachmentIds.count),
            selectionBehavior: .ordered, matching: .images
          ) {
            Image(systemName: "plus").frame(
              width: PalTheme.composerControlSize, height: PalTheme.composerControlSize)
          }
          .tint(Color(uiColor: .label))
          .disabled(
            preparingPhotos || store.sending || store.hasPendingSend
              || store.attachmentIds.count >= 10
          )
          .accessibilityLabel("Attach images")
          TextField("message \(AssistantIdentity.name)", text: $store.draft, axis: .vertical)
            .lineLimit(1...6).padding(.vertical, 4)
            .focused(focused)
            .accessibilityIdentifier("chatComposer")
            .disabled(store.hasPendingSend && !store.sending)
          if preparingPhotos {
            ProgressView().controlSize(.small).accessibilityLabel("Preparing images")
          }
          Group {
            if sendDisabled {
              sendButton.buttonStyle(.plain)
                .foregroundStyle(Color(uiColor: .secondaryLabel))
                .padding(10)
                .background(Color(uiColor: .tertiarySystemFill), in: .circle)
                .transition(.opacity)
            } else {
              sendButton.buttonStyle(.borderedProminent).transition(.opacity)
            }
          }
          .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: sendDisabled)
          .buttonBorderShape(.circle)
          .frame(minWidth: PalTheme.composerControlSize, minHeight: PalTheme.composerControlSize)
          .disabled(sendDisabled)
          .accessibilityLabel(
            store.needsSendRetry
              ? "Retry send"
              : store.isAwaitingSendReconciliation ? "Message sent, syncing" : "Send message"
          )
          .accessibilityIdentifier("sendMessage")
        }
        .padding(.leading, 4).padding(.trailing, 6)
        .padding(.vertical, PalTheme.composerVerticalPadding)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composerContainer")
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
      }
      .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: focused.wrappedValue)
    }
    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: store.attachmentIds)
    .padding(.horizontal, PalTheme.spacing).padding(.bottom, 8)
    .onChange(of: photos) { _, selection in
      guard !selection.isEmpty else { return }
      preparingPhotos = true
      Task {
        defer {
          preparingPhotos = false
          photos = []
        }
        for jpeg in await ChatPhotoEncoding.prepare(selection) {
          if let jpeg {
            await store.stageImage(jpeg)
          } else {
            store.error = "Couldn’t read that image."
          }
        }
      }
    }
  }

  private var sendDisabled: Bool {
    store.sending || preparingPhotos || store.isAwaitingSendReconciliation
      || (!store.hasPendingSend
        && store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && store.attachmentIds.isEmpty)
  }

  private var sendSymbol: String {
    store.isAwaitingSendReconciliation
      ? "checkmark" : store.needsSendRetry ? "arrow.clockwise" : "arrow.up"
  }

  private var sendButton: some View {
    Button {
      Task { await store.send() }
    } label: {
      ZStack {
        if store.sending {
          ProgressView().tint(.primary).transition(.opacity)
        } else {
          Image(systemName: sendSymbol)
            .contentTransition(.opacity)
            .transition(.opacity)
        }
      }
      .frame(width: 20, height: 20)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: store.sending)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: sendSymbol)
    }
  }
}

enum ChatPhotoEncoding {
  static func prepare(_ photos: [PhotosPickerItem]) async -> [Data?] {
    await prepare(count: photos.count) { index in
      guard let raw = try? await photos[index].loadTransferable(type: Data.self) else { return nil }
      return await jpeg(from: raw)
    }
  }

  /// Bound full-resolution decoding memory while retaining the picker's selection order.
  static func prepare(
    count: Int, convert: @escaping @Sendable (Int) async -> Data?
  ) async -> [Data?] {
    await withTaskGroup(of: (Int, Data?).self) { group in
      var result = [Data?](repeating: nil, count: count)
      var next = 0
      for index in 0..<min(3, count) {
        group.addTask { (index, await convert(index)) }
        next += 1
      }
      for await (index, bytes) in group {
        result[index] = bytes
        if next < count {
          let index = next
          group.addTask { (index, await convert(index)) }
          next += 1
        }
      }
      return result
    }
  }

  @concurrent static func jpeg(from data: Data) async -> Data? {
    UIImage(data: data)?.jpegData(compressionQuality: 0.85)
  }
}
