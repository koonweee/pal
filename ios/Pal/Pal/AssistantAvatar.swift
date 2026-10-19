import SwiftUI

struct AssistantAvatar: View {
  var isWorking = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Image(systemName: "circle.circle.fill").resizable().scaledToFit()
      .symbolRenderingMode(.hierarchical)
      .foregroundStyle(.tint)
      .padding(PalTheme.avatarPadding)
      .frame(width: PalTheme.avatarSize, height: PalTheme.avatarSize)
      .background(PalTheme.avatarBackground, in: .circle)
      .clipShape(.circle)
      .overlay { Circle().strokeBorder(PalTheme.avatarBorder, lineWidth: 0.5) }
      .overlay { if isWorking { AssistantWorkingGlint().transition(.opacity) } }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: isWorking)
      .accessibilityHidden(true)
  }
}

struct AssistantProfile: View {
  let name: String
  var isWorking = false

  var body: some View {
    VStack(spacing: -4) {
      AssistantAvatar(isWorking: isWorking).zIndex(1)
      Text(name)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.primary)
        .padding(.horizontal, 14).padding(.vertical, 5)
        .glassEffect(.regular, in: .capsule)
        .accessibilityLabel(name)
        .accessibilityValue(isWorking ? "Working" : "")
        .accessibilityIdentifier("assistantProfile")
        .accessibilityAddTraits(.isHeader)
    }
  }
}

private struct AssistantWorkingGlint: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
      let rotation =
        reduceMotion
        ? 0
        : context.date.timeIntervalSinceReferenceDate
          .truncatingRemainder(dividingBy: 3.6) / 3.6 * 360
      let pink =
        colorScheme == .dark
        ? Color(red: 0.98, green: 0.42, blue: 0.67)
        : Color(red: 0.87, green: 0.26, blue: 0.53)
      let core =
        colorScheme == .dark
        ? Color(red: 1, green: 0.84, blue: 0.91)
        : Color(red: 0.95, green: 0.40, blue: 0.64)
      let gradient = AngularGradient(
        stops: [
          .init(color: .clear, location: 0),
          .init(color: .clear, location: 0.58),
          .init(color: pink, location: 0.78),
          .init(color: core, location: 0.90),
          .init(color: .clear, location: 1),
        ], center: .center, angle: .degrees(rotation))
      ZStack {
        Circle().stroke(gradient, lineWidth: 7).blur(radius: 3)
          .opacity(0.7).clipShape(.circle)
        // Match the centerline of the existing 0.5-point strokeBorder.
        Circle().inset(by: 0.25).stroke(gradient, lineWidth: 1.5)
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

#Preview("Light avatar") {
  AssistantProfile(name: AssistantIdentity.name).padding()
    .preferredColorScheme(.light)
}

#Preview("Dark avatar") {
  AssistantProfile(name: AssistantIdentity.name).padding()
    .preferredColorScheme(.dark)
}
