@preconcurrency import MarkdownUI
import SwiftUI

@MainActor
struct MessageText: View {
  let text: String
  let format: String
  private let markdownContent: MarkdownContent?

  init(text: String, format: String) {
    self.text = text
    self.format = format
    markdownContent = format == "markdown" ? PalMarkdownCache.shared.content(for: text) : nil
  }

  var body: some View {
    if let markdownContent {
      Markdown(markdownContent)
        .font(.body)
        .foregroundStyle(Color(uiColor: .label))
        .markdownTheme(.pal)
        .markdownImageProvider(PalMarkdownImageProvider())
        .markdownInlineImageProvider(PalMarkdownInlineImageProvider())
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    } else {
      Text(verbatim: text)
        .foregroundStyle(Color(uiColor: .label))
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

@MainActor
private final class PalMarkdownCache {
  static let shared = PalMarkdownCache()
  private let values = NSCache<NSString, MarkdownContentBox>()

  private init() { values.countLimit = 250 }

  func content(for source: String) -> MarkdownContent {
    if let cached = values.object(forKey: source as NSString) { return cached.content }
    let content = MarkdownContent(source)
    values.setObject(MarkdownContentBox(content), forKey: source as NSString)
    return content
  }
}

private final class MarkdownContentBox: NSObject {
  let content: MarkdownContent
  init(_ content: MarkdownContent) { self.content = content }
}

private struct PalMarkdownImageProvider: ImageProvider {
  func makeImage(url: URL?) -> some View { EmptyView() }
}

private struct PalMarkdownInlineImageProvider: InlineImageProvider {
  func image(with url: URL, label: String) async throws -> Image {
    throw PalMarkdownImageError.blocked
  }
}

private enum PalMarkdownImageError: Error { case blocked }

extension Theme {
  @MainActor fileprivate static var pal: Theme {
    Theme.basic
      .heading1 { palHeading($0, scale: 1.35) }
      .heading2 { palHeading($0, scale: 1.2) }
      .heading3 { palHeading($0, scale: 1.05) }
      .heading4 { palHeading($0, scale: 1.05) }
      .heading5 { palHeading($0, scale: 1.05) }
      .heading6 { palHeading($0, scale: 1.05) }
      .table { configuration in
        ScrollView(.horizontal) {
          configuration.label.fixedSize(horizontal: true, vertical: true)
        }
        .markdownTableBorderStyle(.init(color: Color(uiColor: .separator)))
        .markdownMargin(top: .zero, bottom: .em(1))
      }
  }
}

@MainActor
private func palHeading(_ configuration: BlockConfiguration, scale: CGFloat) -> some View {
  configuration.label
    .markdownTextStyle {
      FontWeight(.semibold)
      FontSize(.em(scale))
    }
    .markdownMargin(top: .em(0.8), bottom: .em(0.4))
}
