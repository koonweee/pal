import SwiftUI

enum PalTheme {
  static let spacing: CGFloat = 12
  static let messageRadius: CGFloat = 20
  static let sendingOpacity = 0.76
  static let composerControlSize: CGFloat = 44
  static let composerVerticalPadding: CGFloat = 4
  static let typingDotSize: CGFloat = 6
  static let avatarSize: CGFloat = 55
  static let avatarPadding: CGFloat = 2
  static let avatarBackground = Color(uiColor: .secondarySystemBackground)
  static let avatarBorder = Color(uiColor: .separator)
  static let contentBackground = Color(uiColor: .systemBackground)
  static let assistantBackground = Color(uiColor: .secondarySystemBackground)
}
struct PalScreen<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View { content.background(PalTheme.contentBackground) }
}
struct ConnectionStatusView: View {
  let connection: String
  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(connection == "Connected" ? Color.green : Color.secondary)
        .frame(width: 6, height: 6).accessibilityHidden(true)
      Text(connection)
    }
    .font(.caption).foregroundStyle(.primary)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("connectionStatus")
  }
}

struct AssistantTypingBubble: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack {
      HStack(spacing: 5) {
        ForEach(0..<3) { index in
          if reduceMotion {
            dot
          } else {
            dot.phaseAnimator([false, true]) { dot, raised in
              dot.opacity(raised ? 1 : 0.4).offset(y: raised ? -3 : 0)
            } animation: { _ in
              .easeInOut(duration: 0.5).delay(Double(index) * 0.15)
            }
          }
        }
      }
      .frame(height: 20)
      .padding(PalTheme.spacing)
      .background(PalTheme.assistantBackground, in: .rect(cornerRadius: PalTheme.messageRadius))
      Spacer(minLength: 36)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Reply arriving")
    .accessibilityIdentifier("assistantTypingBubble")
  }
  private var dot: some View {
    Circle().fill(.secondary).frame(width: PalTheme.typingDotSize, height: PalTheme.typingDotSize)
  }
}
