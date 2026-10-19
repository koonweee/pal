import Foundation
import Observation

@MainActor @Observable final class ConnectionSettings {
  var address: String
  var connected: Bool
  private let defaults: UserDefaults
  init(
    defaults: UserDefaults = .standard, service: String = "com.example.pal.native",
    defaultAddress: String = ""
  ) {
    self.defaults = defaults
    let savedAddress = defaults.string(forKey: "pal.native.server") ?? defaultAddress
    address = savedAddress
    connected = (try? ChatConnection(address: savedAddress)) != nil
  }
  func save(address: String) throws {
    let connection = try ChatConnection(address: address)
    self.address = connection.url.absoluteString
    defaults.set(self.address, forKey: "pal.native.server")
    connected = true
  }
  func client() throws -> ChatClient {
    return ChatClient(connection: try ChatConnection(address: address))
  }
}
