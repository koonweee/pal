import SwiftUI

@main struct PalApp: App {
  @UIApplicationDelegateAdaptor(PalAppDelegate.self) private var appDelegate
  var body: some Scene { WindowGroup { PalAppShell() } }
}
struct PalAppShell: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var push = PushNotifications.shared
  @State private var settings = ConnectionSettings(
    defaultAddress: Bundle.main.object(forInfoDictionaryKey: "PalDefaultServerURL") as? String ?? ""
  )
  @State private var store: ConversationStore?
  @State private var selectedTab = "chat"
  @State private var taskPath: [String] = []
  var body: some View {
    TabView(selection: $selectedTab) {
      Tab(value: "chat") {
        NavigationStack {
          Group {
            if let store {
              ChatScreen(store: store, selectedTab: $selectedTab).id(ObjectIdentifier(store))
            } else {
              ContentUnavailableView {
                Label("Connect to Pal", systemImage: "bubble.left.and.bubble.right")
              } description: {
                Text("Use your private Tailscale server to continue your conversation.")
              } actions: {
                Button("Set up connection") { selectedTab = "settings" }.buttonStyle(
                  .borderedProminent)
              }
            }
          }
          .toolbar(.hidden, for: .tabBar)
          .safeAreaBar(edge: .top, spacing: 0) { profile }
          .safeAreaBar(edge: .bottom, spacing: 0) {
            if store == nil { PalNavigationBar(selection: $selectedTab) }
          }
        }
      } label: {
        Label("Chat", systemImage: "bubble.left.and.bubble.right.fill").labelStyle(.iconOnly)
      }
      Tab(value: "tasks") {
        NavigationStack(path: $taskPath) {
          Group {
            if let store {
              OwnerTasksScreen(
                selectedTab: $selectedTab, store: store.tasks,
                storageKey: "pal.native." + settings.address
              )
              .safeAreaBar(edge: .top, spacing: 0) { profile }
            } else {
              ContentUnavailableView("Connect to see tasks", systemImage: "checklist")
                .pageNavigation(selection: $selectedTab)
            }
          }
          .toolbar(.hidden, for: .tabBar)
        }
        .id(store.map { ObjectIdentifier($0) })
      } label: {
        Label("Tasks", systemImage: "checklist").labelStyle(.iconOnly)
      }
      Tab(value: "settings") {
        NavigationStack {
          SettingsView(
            settings: settings, connection: store?.connectionState ?? "Not configured",
            connectionError: store?.connectionError, onSave: { connect() }
          )
          .pageNavigation(selection: $selectedTab)
          .toolbar(.hidden, for: .tabBar)
          .safeAreaBar(edge: .top, spacing: 0) { profile }
        }
      } label: {
        Label("Settings", systemImage: "gearshape.fill").labelStyle(.iconOnly)
      }
    }
    .onAppear {
      if store == nil { connect() }
      push.consumeTap()
      if push.openConversation > 0 { routeNotification() }
    }
    .onChange(of: push.openConversation) { _, _ in
      routeNotification()
    }
    .task(id: "\(scenePhase)-\(store.map { String(describing: ObjectIdentifier($0)) } ?? "none")") {
      if scenePhase == .active, let store { await store.run() }
    }
    .task(id: scenePhase) {
      if scenePhase == .active {
        await push.refresh()
        push.consumeTap()
      }
    }
  }
  private var profile: some View {
    AssistantProfile(
      name: AssistantIdentity.name,
      isWorking: store?.activity.state == "working"
    )
    .frame(maxWidth: .infinity)
    .padding(.horizontal, PalTheme.spacing).padding(.top, 4).padding(.bottom, 8)
  }
  private func routeNotification() {
    taskPath = []
    selectedTab = "chat"
  }
  private func connect() {
    #if DEBUG
      let arguments = ProcessInfo.processInfo.arguments
      if arguments.contains("-pal-fixture") || arguments.contains("-pal-network-fixture") {
        let keyIndex = arguments.firstIndex(of: "-pal-fixture-key")
        let fixtureKey =
          keyIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
          ?? "pal.fixture"
        if let networkIndex = arguments.firstIndex(of: "-pal-network-fixture"),
          arguments.indices.contains(networkIndex + 1),
          let connection = try? ChatConnection(
            address: arguments[networkIndex + 1])
        {
          store = ConversationStore(service: ChatClient(connection: connection), key: fixtureKey)
        } else {
          store = ConversationStore(
            service: FixtureChatService(
              document: arguments.contains("-pal-fixture-document"),
              rich: arguments.contains("-pal-fixture-rich"),
              scrolling: arguments.contains("-pal-fixture-scroll"),
              performance: arguments.contains("-pal-fixture-performance"),
              stagedReply: arguments.contains("-pal-fixture-staged-reply"),
              markdown: arguments.contains("-pal-fixture-markdown"),
              paginated: arguments.contains("-pal-fixture-pagination"),
              slowSend: arguments.contains("-pal-fixture-slow-send"),
              rejectSend: arguments.contains("-pal-fixture-reject-send"),
              ownerTasks: arguments.contains("-pal-fixture-tasks"),
              emptyTaskDetails: arguments.contains("-pal-fixture-empty-task-details"),
              persistenceKey: fixtureKey + ".service",
              imageCount: arguments.firstIndex(of: "-pal-fixture-image-count").flatMap {
                arguments.indices.contains($0 + 1) ? Int(arguments[$0 + 1]) : nil
              } ?? 0,
              imageRole: arguments.contains("-pal-fixture-owner-images") ? "owner" : "assistant",
              mixedImages: arguments.contains("-pal-fixture-mixed-images")),
            key: fixtureKey,
            presentation: MessagePresentation {
              arguments.contains("-pal-fixture-observe-arrival")
                ? .seconds(5) : .milliseconds(120)
            })
        }
        return
      }
    #endif
    if let client = try? settings.client() {
      store = ConversationStore(service: client, key: "pal.native.chat." + settings.address)
      push.connect(address: settings.address, store: store)
      push.consumeTap()
    }
  }
}
struct SettingsView: View {
  let settings: ConnectionSettings
  let connection: String
  let connectionError: String?
  let onSave: () -> Void
  @State private var address = ""
  @State private var error: String?
  @FocusState private var addressFocused: Bool
  var body: some View {
    Form {
      Section {
        TextField("https://server", text: $address).textContentType(.URL)
          .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          .accessibilityLabel("Backend HTTPS address")
          .focused($addressFocused)
        Button("Save") {
          do {
            try settings.save(address: address)
            address = settings.address
            error = nil
            addressFocused = false
            onSave()
          } catch { self.error = error.localizedDescription }
        }
        .disabled(address == settings.address)
      } header: {
        Text("Backend")
      } footer: {
        VStack(alignment: .leading, spacing: 8) {
          ConnectionStatusView(connection: connection)
          if let connectionError {
            Text(connectionError).accessibilityIdentifier("connectionDiagnostic")
          }
          if let error { Text(error).foregroundStyle(.red) }
        }
        .foregroundStyle(Color(uiColor: .label))
      }
      NotificationSettingsSection()
    }
    .tint(.primary)
    .onAppear {
      address = settings.address
      error = nil
    }
  }
}
#Preview("Chat") {
  NavigationStack {
    ChatScreen(store: ConversationStore(service: FixtureChatService(), key: "pal.preview"))
  }
}

/// Native destination picker; the shell owns page selection and retained tab state.
struct PalNavigationMenu: View {
  @Binding var selection: String
  private var symbol: String {
    switch selection {
    case "tasks": "checklist"
    case "settings": "gearshape.fill"
    default: "bubble.left.and.bubble.right.fill"
    }
  }
  var body: some View {
    Menu {
      Picker("Page", selection: $selection) {
        Label("Chat", systemImage: "bubble.left.and.bubble.right.fill").tag("chat")
        Label("Tasks", systemImage: "checklist").tag("tasks")
        Label("Settings", systemImage: "gearshape.fill").tag("settings")
      }
      .pickerStyle(.inline)
    } label: {
      Image(systemName: symbol)
        .frame(width: PalTheme.composerControlSize, height: PalTheme.composerControlSize)
        .padding(.vertical, PalTheme.composerVerticalPadding)
        .padding(.horizontal, PalTheme.composerVerticalPadding)
    }
    .buttonStyle(.plain)
    .glassEffect(.regular.interactive(), in: .circle)
    .menuIndicator(.hidden)
    .menuOrder(.fixed)
    .accessibilityLabel("Switch page")
    .accessibilityValue(selection == "chat" ? "Chat" : selection.capitalized)
    .accessibilityIdentifier("pageSwitcher")
  }
}

struct PalNavigationBar: View {
  @Binding var selection: String
  var archivedFilter: Binding<Bool>? = nil
  var body: some View {
    HStack {
      PalNavigationMenu(selection: $selection)
      Spacer()
      if let archivedFilter {
        Menu {
          Toggle("Archived", isOn: archivedFilter)
        } label: {
          Image(systemName: "line.3.horizontal.decrease")
            .frame(width: PalTheme.composerControlSize, height: PalTheme.composerControlSize)
            .padding(PalTheme.composerVerticalPadding)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .menuIndicator(.hidden)
        .accessibilityLabel("Filter tasks")
        .accessibilityValue(archivedFilter.wrappedValue ? "Archived" : "Non-archived")
        .accessibilityIdentifier("taskFilter")
      }
    }
    .padding(.horizontal, PalTheme.spacing).padding(.bottom, 8)
    .padding(.top, PalTheme.composerVerticalPadding)
  }
}
extension View {
  func pageNavigation(selection: Binding<String>, archivedFilter: Binding<Bool>? = nil) -> some View
  {
    self.scrollEdgeEffectStyle(.soft, for: .vertical)
      .safeAreaBar(edge: .bottom, spacing: 0) {
        PalNavigationBar(selection: selection, archivedFilter: archivedFilter)
      }
  }
}
