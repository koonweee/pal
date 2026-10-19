import SwiftUI

struct ChatScreen: View {
  @Bindable var store: ConversationStore
  @Binding var selectedTab: String
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @FocusState private var composerFocused: Bool
  @State private var position: ScrollPosition
  @State private var firstMessageFrame: CGRect = .zero
  @State private var visibleRect: CGRect = .zero
  @State private var paginationPosition: HistoryScrollPosition?
  @State private var followsLatest: Bool
  // Keep the saved target through initial deferred layout, until the user takes over.
  @State private var initialReadingPosition: String?
  @State private var showsScrollToBottom = false
  @State private var arrivalAnimationDeadline: ContinuousClock.Instant?
  @ScaledMetric(relativeTo: .body) private var scrollToBottomThreshold: CGFloat = 60

  init(store: ConversationStore, selectedTab: Binding<String> = .constant("chat")) {
    _selectedTab = selectedTab
    self.store = store
    let followsLatest =
      store.readingPosition == nil || store.readingPosition == store.messages.last?.id
    _followsLatest = State(initialValue: followsLatest)
    _initialReadingPosition = State(initialValue: followsLatest ? nil : store.readingPosition)
    if !followsLatest, let id = store.readingPosition {
      _position = State(initialValue: ScrollPosition(id: id, anchor: .top))
    } else {
      _position = State(initialValue: ScrollPosition(idType: String.self))
    }
  }

  var body: some View {
    let latestReadMessageID = store.latestReadMessageID
    PalScreen {
      VStack(spacing: 0) {
        ScrollView {
          // MarkdownUI rows pass the exact reading-position regressions with lazy loading,
          // keeping offscreen messages out of the view hierarchy.
          LazyVStack(spacing: 0) {
            if store.before != nil {
              Button("Load earlier messages") { loadEarlier() }.disabled(
                store.loading
              ).padding(.bottom, PalTheme.spacing)
            }
            ForEach(visibleMessages) { message in
              MessageRow(
                message: message, store: store,
                showsReadReceipt: message.id == latestReadMessageID
              ).padding(.bottom, PalTheme.spacing).id(message.id)
                .transition(
                  .asymmetric(
                    insertion: .opacity.combined(with: .offset(y: reduceMotion ? 0 : 8)),
                    removal: .identity)
                )
                .onGeometryChange(for: CGRect.self) { geometry in
                  geometry.frame(in: .named("conversation-content"))
                } action: { frame in
                  if message.id == store.messages.first?.id { firstMessageFrame = frame }
                }
            }
            if store.presentation.leadInDuration != nil {
              AssistantTypingBubble().padding(.bottom, PalTheme.spacing).id("assistant-typing")
                .transition(.asymmetric(insertion: .opacity, removal: .identity))
            }
            Color.clear.frame(height: 1).id("conversation-bottom")
          }
          .scrollTargetLayout().padding(.horizontal, PalTheme.spacing).padding(
            .top, PalTheme.spacing
          )
          .coordinateSpace(name: "conversation-content")
        }
        .scrollPosition($position, anchor: .top)
        .defaultScrollAnchor(.bottom)
        .onScrollGeometryChange(for: CGRect.self) {
          // Scroll anchors use the inset-adjusted origin and container height;
          // visibleRect also includes content behind the floating safe-area bars.
          CGRect(
            x: 0,
            y: $0.contentOffset.y + $0.contentInsets.top,
            width: $0.containerSize.width,
            height: $0.containerSize.height)
        } action: { _, rect in
          visibleRect = rect
        }
        .onScrollGeometryChange(for: ConversationLayout.self) { geometry in
          ConversationLayout(
            contentHeight: geometry.contentSize.height,
            containerHeight: geometry.containerSize.height,
            insets: geometry.contentInsets)
        } action: { _, _ in
          // Structured Markdown finishes its layout after the row first appears.
          if let saved = paginationPosition,
            store.messages.first?.id != saved.id || store.before == nil
          {
            position.scrollTo(id: saved.id, anchor: saved.anchor)
          } else if followsLatest {
            followLatest()
          } else if let id = initialReadingPosition {
            position.scrollTo(id: id, anchor: .top)
          }
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
          geometry.contentSize.height
            - (geometry.contentOffset.y + geometry.contentInsets.top + geometry.containerSize.height)
            > scrollToBottomThreshold
        } action: { _, isAboveBottom in
          showsScrollToBottom = isAboveBottom
        }
        .onScrollPhaseChange { oldPhase, newPhase, context in
          if newPhase == .tracking || newPhase == .interacting {
            initialReadingPosition = nil
            paginationPosition = nil
          }
          if newPhase == .interacting {
            followsLatest = false
          } else if newPhase == .idle
            && [.tracking, .interacting, .decelerating].contains(oldPhase)
          {
            let geometry = context.geometry
            followsLatest =
              geometry.contentOffset.y + geometry.contentInsets.top + geometry.containerSize.height
              >= geometry.contentSize.height - 80
            if followsLatest { store.readingPosition = nil }
          }
        }
        .scrollDismissesKeyboard(.immediately)
        .scrollEdgeEffectStyle(.soft, for: .vertical)
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
        .accessibilityIdentifier("conversation")
        .overlay {
          if store.displayedMessages.isEmpty && store.presentation.leadInDuration == nil {
            if store.loading {
              ProgressView("Loading conversation")
            } else {
              ContentUnavailableView(
                "Say hello to Pal", systemImage: "bubble.left.and.bubble.right",
                description: Text("Your ongoing conversation starts here."))
            }
          }
        }
        .overlay(alignment: .bottom) {
          // Following latest includes the native scroll and any intervening layout changes.
          if showsScrollToBottom && !followsLatest {
            Button {
              initialReadingPosition = nil
              paginationPosition = nil
              followsLatest = true
              store.readingPosition = nil
              scrollToBottom()
            } label: {
              Image(systemName: "chevron.down").frame(width: 20, height: 20)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .frame(minWidth: PalTheme.composerControlSize, minHeight: PalTheme.composerControlSize)
            .accessibilityLabel("Scroll to bottom")
            .accessibilityIdentifier("scrollToBottom")
            .padding(.bottom, PalTheme.spacing)
            .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 4)))
          }
        }
        .animation(
          reduceMotion ? nil : .easeOut(duration: 0.16),
          value: showsScrollToBottom && !followsLatest
        )
        .onAppear {
          if followsLatest {
            position.scrollTo(id: "conversation-bottom", anchor: .bottom)
          } else if let id = initialReadingPosition {
            position.scrollTo(id: id, anchor: .top)
          }
        }
        .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.1) { ids in
          guard !followsLatest, initialReadingPosition == nil else { return }
          store.readingPosition = store.messages.first { ids.contains($0.id) }?.id
        }
        .onChange(of: store.readingPosition) { _, id in
          if id == nil && initialReadingPosition != nil {
            initialReadingPosition = nil
            followsLatest = true
            position.scrollTo(id: "conversation-bottom", anchor: .bottom)
          }
        }
        .onChange(of: store.presentation.revision) { _, _ in
          arrivalAnimationDeadline =
            reduceMotion || !followsLatest ? nil : .now.advanced(by: .milliseconds(240))
          if followsLatest { followLatest() }
        }
        .onChange(of: latestMessageID) { _, _ in
          if followsLatest {
            store.readingPosition = nil
            followLatest()
          }
        }
        .task(id: store.presentation.leadInDuration) {
          guard let duration = store.presentation.leadInDuration else { return }
          do { try await Task.sleep(for: duration) } catch { return }
          withAnimation(arrivalAnimation) { store.presentation.reveal() }
        }
        .onChange(of: scenePhase) { _, phase in
          if phase != .active { store.presentation.reset() }
        }
        .onDisappear { store.presentation.reset() }

      }
      .safeAreaBar(edge: .bottom, spacing: 0) {
        VStack(spacing: 4) {
          if let error = store.error {
            HStack {
              Text(error).font(.caption)
              Button("Dismiss", systemImage: "xmark") { store.error = nil }.labelStyle(.iconOnly)
            }.padding(.horizontal).foregroundStyle(.secondary)
              .transition(.opacity)
          }
          ChatComposer(store: store, focused: $composerFocused, selectedTab: $selectedTab)
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.18), value: store.error)
        .padding(.top, PalTheme.composerVerticalPadding)
      }
      .animation(arrivalAnimation, value: store.presentation.revision)
    }
  }
  private func loadEarlier() {
    if let id = store.messages.first?.id {
      // A native ID anchor preserves the row's current viewport offset, rather
      // than aligning it to the top when earlier rows are inserted.
      let availableHeight = visibleRect.height - firstMessageFrame.height
      let anchorY =
        availableHeight == 0 ? 0 : (firstMessageFrame.minY - visibleRect.minY) / availableHeight
      paginationPosition = HistoryScrollPosition(id: id, anchor: UnitPoint(x: 0.5, y: anchorY))
      initialReadingPosition = nil
      followsLatest = false
    }
    Task {
      await store.loadEarlier()
      if let saved = paginationPosition,
        store.messages.first?.id != saved.id || store.before == nil
      {
        position.scrollTo(id: saved.id, anchor: saved.anchor)
      }
    }
  }

  private var latestMessageID: String? {
    store.presentation.leadInDuration != nil ? "assistant-typing" : visibleMessages.last?.id
  }
  private var visibleMessages: [ChatMessage] {
    store.displayedMessages.filter { !store.presentation.pendingMessageIDs.contains($0.id) }
  }
  private var arrivalAnimation: Animation? {
    reduceMotion || !followsLatest ? nil : .smooth(duration: 0.24)
  }
  private func followLatest() {
    if let deadline = arrivalAnimationDeadline, .now < deadline {
      withAnimation(arrivalAnimation) {
        position.scrollTo(id: "conversation-bottom", anchor: .bottom)
      }
    } else {
      position.scrollTo(id: "conversation-bottom", anchor: .bottom)
    }
  }
  private func scrollToBottom() {
    if reduceMotion {
      position.scrollTo(id: "conversation-bottom", anchor: .bottom)
    } else {
      withAnimation { position.scrollTo(id: "conversation-bottom", anchor: .bottom) }
    }
  }
}

private struct ConversationLayout: Equatable {
  let contentHeight: CGFloat
  let containerHeight: CGFloat
  let insets: EdgeInsets
}

private struct HistoryScrollPosition {
  let id: String
  let anchor: UnitPoint
}
