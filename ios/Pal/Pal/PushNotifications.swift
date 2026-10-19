import Foundation
import Network
import Observation
import Security
import SwiftUI
import UIKit
import UserNotifications

struct PushRegistration: Codable, Equatable {
  let id: String
  let address: String
}

@MainActor @Observable final class PushNotifications {
  static let shared = PushNotifications()
  var status = "Notifications are off"
  var authorization: UNAuthorizationStatus = .notDetermined
  var openConversation = 0
  private var deviceToken: String?
  private var current: PushRegistration?
  private var syncing = false
  private var needsSync = false
  private let monitor = NWPathMonitor()
  private let center = UNUserNotificationCenter.current()
  private let storage: String
  private let defaults: UserDefaults
  private let makeClient: (ChatConnection) -> any ChatService
  private weak var conversation: ConversationStore?
  private var savedAddress: String {
    defaults.string(forKey: "pal.native.server")
      ?? (Bundle.main.object(forInfoDictionaryKey: "PalDefaultServerURL") as? String ?? "")
  }
  var fixture: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-pal-fixture")
        || ProcessInfo.processInfo.arguments.contains("-pal-network-fixture")
    #else
      false
    #endif
  }
  init(
    defaults: UserDefaults = .standard, storage: String = "com.example.pal.native.push",
    monitorNetwork: Bool = true,
    makeClient: @escaping (ChatConnection) -> any ChatService = {
      ChatClient(connection: $0, timeout: 20)
    }
  ) {
    self.defaults = defaults
    self.storage = storage
    self.makeClient = makeClient
    monitor.pathUpdateHandler = { path in
      if path.status == .satisfied {
        Task { @MainActor in
          if UIApplication.shared.applicationState == .active {
            await PushNotifications.shared.refresh()
          }
        }
      }
    }
    if monitorNetwork { monitor.start(queue: DispatchQueue(label: "pal.push.network")) }
    var result: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: storage, kSecAttrAccount as String: "registrations",
      kSecReturnData as String: true,
    ]
    if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data,
      let saved = try? JSONDecoder().decode(PushRegistration.self, from: data)
    {
      current = saved.address == savedAddress ? saved : nil
    }
  }
  private func persist() {
    guard !fixture, let current, let data = try? JSONEncoder().encode(current)
    else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: storage, kSecAttrAccount as String: "registrations",
    ]
    let result = SecItemUpdate(
      query as CFDictionary,
      [
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      ] as CFDictionary)
    if result == errSecItemNotFound {
      var add = query
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      if SecItemAdd(add as CFDictionary, nil) != errSecSuccess {
        status = "Couldn’t save notification registration"
      }
    } else if result != errSecSuccess {
      status = "Couldn’t save notification registration"
    }
  }
  func connect(address: String, store: ConversationStore? = nil) {
    conversation = store
    guard !fixture else { return }
    if current?.address == address {
      persist()
      return
    }
    current = PushRegistration(id: UUID().uuidString, address: address)
    persist()
    Task { await refresh() }
  }
  func refresh() async {
    let settings = await center.notificationSettings()
    authorization = settings.authorizationStatus
    if authorization == .denied {
      status = "Notifications are disabled in Settings"
    } else if authorization == .notDetermined {
      status = "Notifications are off"
    } else {
      status = "Connecting notifications…"
    }
    if !fixture && (authorization == .authorized || authorization == .provisional) {
      UIApplication.shared.registerForRemoteNotifications()
    }
    await sync()
  }
  func enable() async {
    do {
      _ = try await center.requestAuthorization(options: [.alert, .sound])
      await refresh()
    } catch { status = "Couldn’t request notification permission" }
  }
  func registered(_ data: Data) {
    deviceToken = data.map { String(format: "%02x", $0) }.joined()
    Task { await sync() }
  }
  func registrationFailed() {
    status = "Couldn’t register notifications. Try again when connected."
  }
  private func sync() async {
    guard !fixture else {
      status = authorization == .authorized ? "Notifications enabled (simulator fixture)" : status
      return
    }
    guard current != nil else { return }
    if syncing {
      needsSync = true
      return
    }
    syncing = true
    defer {
      syncing = false
      if needsSync {
        needsSync = false
        Task { await sync() }
      }
    }
    guard let registration = current else { return }
    do {
      let client = ChatClient(
        connection: try ChatConnection(
          address: registration.address))
      if authorization == .denied || authorization == .notDetermined {
        try await client.removePushRegistration(registration.id)
      } else if let deviceToken {
        guard
          let environment = Bundle.main.object(forInfoDictionaryKey: "PalAPNSEnvironment")
            as? String,
          ["development", "production"].contains(environment)
        else {
          status = "Notification configuration is unavailable"
          return
        }
        try await client.registerPush(
          id: registration.id, token: deviceToken, environment: environment)
        if current == registration { status = "Notifications enabled" }
      }
    } catch {
      if current == registration {
        status = "Notifications aren’t connected. Reopen Pal when your private server is available."
      }
    }
  }
  #if DEBUG
    func scheduleFixture() async {
      guard fixture else { return }
      let content = UNMutableNotificationContent()
      content.title = AssistantIdentity.name
      content.body = "New message"
      content.sound = .default
      content.userInfo = [
        "installationId": "pal-simulator-fixture"
      ]
      try? await center.add(
        UNNotificationRequest(
          identifier: UUID().uuidString, content: content,
          trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)))
    }
  #endif
  func accepts(_ payload: [AnyHashable: Any]) -> Bool {
    guard let id = payload["installationId"] as? String else { return false }
    #if DEBUG
      if fixture { return id == "pal-simulator-fixture" }
    #endif
    return id == current?.id
  }
  func refetch(_ payload: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
    guard !fixture, accepts(payload), let registration = current,
      registration.address == savedAddress,
      let connection = try? ChatConnection(address: registration.address)
    else { return .noData }
    do {
      let client = makeClient(connection)
      let page = try await client.history(before: nil)
      try Task.checkCancellation()
      guard current == registration, savedAddress == registration.address else { return .noData }
      let store =
        conversation
        ?? ConversationStore(
          service: client, key: "pal.native.chat." + registration.address, defaults: defaults)
      return store.refreshInBackground(page) ? .newData : .noData
    } catch {
      // One bounded attempt; normal foreground history/SSE handles recovery.
      return .failed
    }
  }
  private var pendingTap: [AnyHashable: Any]?
  func tapped(_ payload: [AnyHashable: Any]) {
    pendingTap = payload
    consumeTap()
  }
  func consumeTap() {
    guard let pendingTap, accepts(pendingTap) else { return }
    self.pendingTap = nil
    openConversation += 1
  }
}

final class PalAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    PushNotifications.shared.registered(deviceToken)
  }
  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    PushNotifications.shared.registrationFailed()
  }
  func application(
    _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]
  ) async -> UIBackgroundFetchResult {
    await PushNotifications.shared.refetch(userInfo)
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    // The live conversation receives its durable content through history/SSE.
    return []
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping @Sendable () -> Void
  ) {
    let installation = response.notification.request.content.userInfo["installationId"] as? String
    Task { @MainActor in
      var payload: [AnyHashable: Any] = [:]
      if let installation { payload["installationId"] = installation }
      PushNotifications.shared.tapped(payload)
      completionHandler()
    }
  }
}

struct NotificationSettingsSection: View {
  @State private var push = PushNotifications.shared
  var body: some View {
    Section("Notifications") {
      Text(push.status).accessibilityIdentifier("notificationStatus")
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-pal-fixture-notifications") {
          Button("Schedule fixture notification") { Task { await push.scheduleFixture() } }
          Text("Opened notifications: \(push.openConversation)").accessibilityIdentifier(
            "notificationOpenCount")
        }
      #endif
      if push.authorization == .notDetermined {
        Button("Enable Notifications") { Task { await push.enable() } }
      } else {
        Button("Notification Settings") {
          if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            UIApplication.shared.open(url)
          }
        }
      }
    }.task { await push.refresh() }
  }
}
