import AppKit
import AVFoundation
import CoreVideo
import Foundation

let width = 720
let height = 1280
let fps: Int32 = 24
let durationSeconds = 8
let outputURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("public/ios-home-screen-guide.mp4")

try? FileManager.default.removeItem(at: outputURL)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 1_600_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
])
guard writer.canAdd(input) else { fatalError("Video input could not be added") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Video writing failed") }
writer.startSession(atSourceTime: .zero)

let ink = NSColor(calibratedRed: 23/255, green: 32/255, blue: 29/255, alpha: 1)
let muted = NSColor(calibratedRed: 114/255, green: 128/255, blue: 120/255, alpha: 1)
let paper = NSColor.white
let page = NSColor(calibratedRed: 231/255, green: 233/255, blue: 227/255, alpha: 1)
let green = NSColor(calibratedRed: 27/255, green: 89/255, blue: 72/255, alpha: 1)
let lime = NSColor(calibratedRed: 202/255, green: 239/255, blue: 134/255, alpha: 1)
let subtle = NSColor(calibratedRed: 244/255, green: 247/255, blue: 244/255, alpha: 1)

func rounded(_ rect: CGRect, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func circle(_ rect: CGRect, color: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1) {
    let path = NSBezierPath(ovalIn: rect)
    color.setFill()
    path.fill()
    if let stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func text(_ value: String, in rect: CGRect, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = ink, align: NSTextAlignment = .left) {
    let style = NSMutableParagraphStyle()
    style.alignment = align
    style.lineBreakMode = .byWordWrapping
    (value as NSString).draw(in: rect, withAttributes: [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style,
    ])
}

func appIcon(_ rect: CGRect) {
    rounded(rect, radius: rect.width * 0.23, color: green)
    let center = CGPoint(x: rect.minX + rect.width * 0.484, y: rect.minY + rect.height * 0.469)
    let radius = rect.width * 0.277
    let ring = NSBezierPath(ovalIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    lime.setStroke()
    ring.lineWidth = rect.width * 0.109
    ring.stroke()
    let handle = NSBezierPath()
    handle.move(to: CGPoint(x: rect.minX + rect.width * 0.664, y: rect.minY + rect.height * 0.648))
    handle.line(to: CGPoint(x: rect.minX + rect.width * 0.773, y: rect.minY + rect.height * 0.758))
    handle.lineWidth = rect.width * 0.109
    handle.lineCapStyle = .round
    lime.setStroke()
    handle.stroke()
    let bolt = NSBezierPath()
    let points = [(0.539, 0.242), (0.367, 0.523), (0.494, 0.523), (0.445, 0.758), (0.639, 0.430), (0.508, 0.430)]
    bolt.move(to: CGPoint(x: rect.minX + rect.width * points[0].0, y: rect.minY + rect.height * points[0].1))
    for point in points.dropFirst() {
        bolt.line(to: CGPoint(x: rect.minX + rect.width * point.0, y: rect.minY + rect.height * point.1))
    }
    bolt.close()
    paper.setFill()
    bolt.fill()
}

func shareIcon(center: CGPoint, emphasized: Bool, pulse: CGFloat) {
    if emphasized {
        circle(CGRect(x: center.x - 46 - pulse, y: center.y - 46 - pulse, width: 92 + pulse * 2, height: 92 + pulse * 2), color: lime.withAlphaComponent(0.32))
    }
    let box = CGRect(x: center.x - 21, y: center.y - 9, width: 42, height: 36)
    let boxPath = NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5)
    green.setStroke()
    boxPath.lineWidth = 4
    boxPath.stroke()
    text("↑", in: CGRect(x: center.x - 24, y: center.y - 38, width: 48, height: 52), size: 42, weight: .medium, color: green, align: .center)
}

func safariPage(frame: Int) {
    rounded(CGRect(x: 82, y: 58, width: 556, height: 1164), radius: 58, color: ink)
    rounded(CGRect(x: 96, y: 72, width: 528, height: 1136), radius: 47, color: paper)
    text("9:41", in: CGRect(x: 130, y: 95, width: 110, height: 34), size: 22, weight: .semibold)
    text("● ● ●", in: CGRect(x: 472, y: 97, width: 105, height: 28), size: 15, weight: .semibold, align: .right)

    rounded(CGRect(x: 118, y: 154, width: 484, height: 742), radius: 24, color: page)
    appIcon(CGRect(x: 150, y: 195, width: 66, height: 66))
    text("スパQ", in: CGRect(x: 235, y: 204, width: 250, height: 52), size: 31, weight: .bold, color: green)
    text("待ち時間を、\nもっとわかりやすく。", in: CGRect(x: 150, y: 318, width: 415, height: 150), size: 41, weight: .bold)
    text("スーパーチャージャーの待ち列を\nホーム画面からすぐ確認できます。", in: CGRect(x: 150, y: 493, width: 410, height: 100), size: 22, color: muted)
    rounded(CGRect(x: 150, y: 636, width: 388, height: 78), radius: 18, color: green)
    text("さっそく探す", in: CGRect(x: 150, y: 656, width: 388, height: 42), size: 25, weight: .bold, color: paper, align: .center)

    rounded(CGRect(x: 118, y: 939, width: 484, height: 92), radius: 24, color: subtle)
    text("ぁあ", in: CGRect(x: 146, y: 968, width: 72, height: 38), size: 22, color: muted)
    shareIcon(center: CGPoint(x: 360, y: 976), emphasized: true, pulse: CGFloat(sin(Double(frame) / 4.0) * 5 + 5))
    text("⋯", in: CGRect(x: 505, y: 957, width: 64, height: 46), size: 34, weight: .bold, color: muted, align: .center)
    text("1  Safariの共有ボタンを押す", in: CGRect(x: 110, y: 1082, width: 500, height: 68), size: 29, weight: .bold, color: green, align: .center)
}

func shareSheet(frame: Int) {
    rounded(CGRect(x: 82, y: 58, width: 556, height: 1164), radius: 58, color: ink)
    rounded(CGRect(x: 96, y: 72, width: 528, height: 1136), radius: 47, color: page)
    text("2  『ホーム画面に追加』を選ぶ", in: CGRect(x: 110, y: 124, width: 500, height: 62), size: 29, weight: .bold, color: green, align: .center)

    rounded(CGRect(x: 112, y: 232, width: 496, height: 858), radius: 34, color: paper)
    rounded(CGRect(x: 319, y: 252, width: 82, height: 7), radius: 4, color: NSColor(calibratedWhite: 0.82, alpha: 1))
    text("共有", in: CGRect(x: 150, y: 292, width: 420, height: 52), size: 30, weight: .bold, align: .center)
    rounded(CGRect(x: 144, y: 382, width: 432, height: 120), radius: 19, color: subtle)
    appIcon(CGRect(x: 168, y: 404, width: 74, height: 74))
    text("スパQ", in: CGRect(x: 266, y: 412, width: 270, height: 38), size: 25, weight: .semibold)
    text("tesla-supercharger-que.vercel.app", in: CGRect(x: 266, y: 452, width: 280, height: 28), size: 14, color: muted)

    let pulse = CGFloat(sin(Double(frame) / 4.0) * 4 + 4)
    rounded(CGRect(x: 138 - pulse, y: 596 - pulse, width: 444 + pulse * 2, height: 94 + pulse * 2), radius: 20, color: lime.withAlphaComponent(0.45))
    rounded(CGRect(x: 148, y: 606, width: 424, height: 74), radius: 15, color: paper)
    rounded(CGRect(x: 172, y: 621, width: 44, height: 44), radius: 10, color: green)
    text("＋", in: CGRect(x: 171, y: 620, width: 46, height: 44), size: 28, weight: .medium, color: paper, align: .center)
    text("ホーム画面に追加", in: CGRect(x: 238, y: 622, width: 280, height: 42), size: 25, weight: .medium)
    text("›", in: CGRect(x: 518, y: 617, width: 35, height: 45), size: 31, color: muted, align: .center)
    rounded(CGRect(x: 148, y: 710, width: 424, height: 74), radius: 15, color: paper)
    text("コピー", in: CGRect(x: 238, y: 729, width: 280, height: 38), size: 24, color: muted)
    rounded(CGRect(x: 148, y: 804, width: 424, height: 74), radius: 15, color: paper)
    text("ブックマークを追加", in: CGRect(x: 238, y: 823, width: 280, height: 38), size: 24, color: muted)
}

func installedHome(frame: Int) {
    rounded(CGRect(x: 82, y: 58, width: 556, height: 1164), radius: 58, color: ink)
    rounded(CGRect(x: 96, y: 72, width: 528, height: 1136), radius: 47, color: green)
    circle(CGRect(x: 118, y: 98, width: 470, height: 470), color: lime.withAlphaComponent(0.11))
    text("9:41", in: CGRect(x: 130, y: 95, width: 110, height: 34), size: 22, weight: .semibold, color: paper)
    text("● ● ●", in: CGRect(x: 472, y: 97, width: 105, height: 28), size: 15, weight: .semibold, color: paper, align: .right)

    appIcon(CGRect(x: 170, y: 252, width: 150, height: 150))
    text("スパQ", in: CGRect(x: 147, y: 415, width: 196, height: 48), size: 27, weight: .medium, color: paper, align: .center)
    rounded(CGRect(x: 380, y: 252, width: 150, height: 150), radius: 34, color: paper.withAlphaComponent(0.16))
    rounded(CGRect(x: 170, y: 535, width: 150, height: 150), radius: 34, color: paper.withAlphaComponent(0.16))
    rounded(CGRect(x: 380, y: 535, width: 150, height: 150), radius: 34, color: paper.withAlphaComponent(0.16))

    let pulse = CGFloat(sin(Double(frame) / 4.0) * 5 + 5)
    circle(CGRect(x: 155 - pulse, y: 237 - pulse, width: 180 + pulse * 2, height: 180 + pulse * 2), color: lime.withAlphaComponent(0.18), stroke: lime, lineWidth: 4)
    circle(CGRect(x: 300, y: 806, width: 120, height: 120), color: lime)
    text("✓", in: CGRect(x: 300, y: 822, width: 120, height: 75), size: 56, weight: .bold, color: green, align: .center)
    text("3  追加できました", in: CGRect(x: 110, y: 968, width: 500, height: 60), size: 32, weight: .bold, color: paper, align: .center)
    text("次回からホーム画面のスパQを押すだけ", in: CGRect(x: 120, y: 1035, width: 480, height: 66), size: 22, color: paper.withAlphaComponent(0.82), align: .center)
}

func makePixelBuffer(frame: Int) -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
          let pixelBuffer = buffer else { fatalError("Pixel buffer creation failed") }

    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer),
          let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
          ) else { fatalError("Graphics context creation failed") }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    page.setFill()
    NSBezierPath(rect: CGRect(x: 0, y: 0, width: width, height: height)).fill()

    if frame < Int(fps) * 3 {
        safariPage(frame: frame)
    } else if frame < Int(fps) * 6 {
        shareSheet(frame: frame)
    } else {
        installedHome(frame: frame)
    }
    NSGraphicsContext.restoreGraphicsState()
    return pixelBuffer
}

for frame in 0..<(Int(fps) * durationSeconds) {
    while !input.isReadyForMoreMediaData { usleep(1_000) }
    let buffer = makePixelBuffer(frame: frame)
    let time = CMTime(value: Int64(frame), timescale: fps)
    guard adaptor.append(buffer, withPresentationTime: time) else {
        fatalError(writer.error?.localizedDescription ?? "Frame append failed")
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Video finalization failed") }
print(outputURL.path)
