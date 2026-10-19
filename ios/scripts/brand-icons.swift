// Generate deterministic neutral Pal icons. Run: swift ios/scripts/brand-icons.swift
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("ios/Pal/Pal/Assets.xcassets")
let frontend = root.appendingPathComponent("frontend/public/icons")

struct Color {
  let red: CGFloat
  let green: CGFloat
  let blue: CGFloat

  var cgColor: CGColor {
    CGColor(
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
      components: [red, green, blue, 1])!
  }
}

struct Palette {
  let background: Color
  let ring: Color
}

let light = Palette(
  background: Color(red: 1.0, green: 0.973, blue: 0.961),
  ring: Color(red: 0.937, green: 0.502, blue: 0.424)
)
let dark = Palette(
  background: Color(red: 0.110, green: 0.110, blue: 0.118),
  ring: Color(red: 1.0, green: 0.608, blue: 0.529)
)
let developmentBlue = Color(red: 0.06, green: 0.36, blue: 0.94)

func render(size: Int, palette: Palette, development: Bool = false) -> CGImage {
  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.noneSkipLast.rawValue
  let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: size * 4, space: colorSpace, bitmapInfo: bitmapInfo)!
  let scale = CGFloat(size) / 1024

  context.setFillColor(palette.background.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: size, height: size))
  context.setFillColor(palette.ring.cgColor)
  context.fillEllipse(in: CGRect(x: 172, y: 172, width: 680, height: 680).scaled(by: scale))
  context.setFillColor(palette.background.cgColor)
  context.fillEllipse(in: CGRect(x: 352, y: 352, width: 320, height: 320).scaled(by: scale))

  if development {
    context.setStrokeColor(developmentBlue.cgColor)
    context.setLineWidth(54 * scale)
    context.addPath(
      CGPath(
        roundedRect: CGRect(x: 27, y: 27, width: 970, height: 970).scaled(by: scale),
        cornerWidth: 160 * scale, cornerHeight: 160 * scale,
        transform: nil))
    context.strokePath()

    context.setFillColor(developmentBlue.cgColor)
    context.addPath(
      CGPath(
        roundedRect: CGRect(x: 290, y: 25, width: 444, height: 150).scaled(by: scale),
        cornerWidth: 40 * scale, cornerHeight: 40 * scale,
        transform: nil))
    context.fillPath()

    let attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName(
        "HelveticaNeue-Bold" as CFString, 108 * scale, nil),
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): Color(
        red: 1, green: 1, blue: 1
      ).cgColor,
    ]
    let line = CTLineCreateWithAttributedString(
      NSAttributedString(string: "DEV", attributes: attributes))
    let bounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
    context.textPosition = CGPoint(
      x: (CGFloat(size) - bounds.width) / 2 - bounds.minX,
      y: 48 * scale - bounds.minY)
    CTLineDraw(line, context)
  }

  return context.makeImage()!
}

extension CGRect {
  func scaled(by scale: CGFloat) -> CGRect {
    CGRect(
      x: origin.x * scale, y: origin.y * scale,
      width: width * scale, height: height * scale)
  }
}

func write(_ image: CGImage, _ url: URL) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let destination = CGImageDestinationCreateWithURL(
    url as CFURL, UTType.png.identifier as CFString, 1, nil)
  else {
    throw CocoaError(.fileWriteUnknown)
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw CocoaError(.fileWriteUnknown)
  }
}

try write(
  render(size: 1024, palette: light),
  assets.appendingPathComponent("AppIcon.appiconset/AppIcon.png"))
try write(
  render(size: 1024, palette: dark),
  assets.appendingPathComponent("AppIcon.appiconset/AppIcon-dark.png"))
try write(
  render(size: 1024, palette: light, development: true),
  assets.appendingPathComponent("AppIconDev.appiconset/AppIcon.png"))

for size in [192, 512] {
  try write(
    render(size: size, palette: light, development: true),
    frontend.appendingPathComponent("pal-\(size).png"))
  try write(
    render(size: size, palette: light),
    frontend.appendingPathComponent("pal-production-\(size).png"))
}
try write(
  render(size: 180, palette: light, development: true),
  frontend.appendingPathComponent("apple-touch-icon.png"))
try write(
  render(size: 180, palette: light),
  frontend.appendingPathComponent("pal-production-180.png"))
