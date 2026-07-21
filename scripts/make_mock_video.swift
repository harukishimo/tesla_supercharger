import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

struct Scene {
    let file: String
    let seconds: Double
    let cursor: CGPoint?
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let frameDirectory = root.appendingPathComponent("artifacts/mock-video/frames")
let output = root.appendingPathComponent("artifacts/charge-queue-mock.mp4")
try? FileManager.default.removeItem(at: output)

let scenes: [Scene] = [
    Scene(file: "01-search.png", seconds: 2.2, cursor: CGPoint(x: 635, y: 425)),
    Scene(file: "02-station.png", seconds: 2.0, cursor: CGPoint(x: 640, y: 760)),
    Scene(file: "03-join-empty.png", seconds: 1.5, cursor: CGPoint(x: 635, y: 450)),
    Scene(file: "04-nickname.png", seconds: 1.7, cursor: CGPoint(x: 640, y: 700)),
    Scene(file: "05-waiting.png", seconds: 2.4, cursor: CGPoint(x: 780, y: 810)),
    Scene(file: "06-five-minutes.png", seconds: 2.4, cursor: CGPoint(x: 780, y: 810)),
    Scene(file: "07-your-turn.png", seconds: 2.5, cursor: CGPoint(x: 640, y: 700)),
    Scene(file: "08-duration.png", seconds: 1.8, cursor: CGPoint(x: 690, y: 540)),
    Scene(file: "09-duration-selected.png", seconds: 1.7, cursor: CGPoint(x: 640, y: 670)),
    Scene(file: "10-charging.png", seconds: 2.4, cursor: CGPoint(x: 640, y: 735)),
    Scene(file: "11-complete.png", seconds: 3.0, cursor: nil),
]

func loadImage(_ name: String) -> CGImage {
    let url = frameDirectory.appendingPathComponent(name) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fatalError("Unable to load \(name)")
    }
    return image
}

let images = scenes.map { loadImage($0.file) }
let width = images[0].width
let height = images[0].height
let fps: Int32 = 30
let fadeFrames = 12

let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.hevc,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 5_500_000,
    ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
guard writer.canAdd(input) else { fatalError("Cannot add video input") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Writer failed") }
writer.startSession(atSourceTime: .zero)

func makePixelBuffer(current: CGImage, next: CGImage?, blend: CGFloat, cursor: CGPoint?, clickProgress: CGFloat) -> CVPixelBuffer {
    var optionalBuffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer) == kCVReturnSuccess,
          let buffer = optionalBuffer else { fatalError("Pixel buffer failed") }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer),
          let context = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
          ) else { fatalError("Context failed") }

    context.setFillColor(CGColor(gray: 0.93, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let target = CGRect(x: 0, y: 0, width: width, height: height)
    context.setAlpha(1)
    context.draw(current, in: target)
    if let next {
        context.setAlpha(blend)
        context.draw(next, in: target)
    }

    if let cursor {
        let y = CGFloat(height) - cursor.y
        context.saveGState()
        context.setShadow(offset: CGSize(width: 0, height: -2), blur: 5, color: CGColor(gray: 0, alpha: 0.28))
        context.setFillColor(CGColor(gray: 1, alpha: 0.96))
        context.fillEllipse(in: CGRect(x: cursor.x - 8, y: y - 8, width: 16, height: 16))
        context.setLineWidth(2)
        context.setStrokeColor(CGColor(gray: 0.08, alpha: 0.9))
        context.strokeEllipse(in: CGRect(x: cursor.x - 8, y: y - 8, width: 16, height: 16))
        context.restoreGState()
        if clickProgress > 0 {
            let radius = 13 + 15 * clickProgress
            context.setLineWidth(3 * (1 - clickProgress) + 1)
            context.setStrokeColor(CGColor(red: 0.11, green: 0.35, blue: 0.28, alpha: 0.7 * (1 - clickProgress)))
            context.strokeEllipse(in: CGRect(x: cursor.x - radius, y: y - radius, width: radius * 2, height: radius * 2))
        }
    }
    return buffer
}

var frameIndex: Int64 = 0
for sceneIndex in scenes.indices {
    let sceneFrames = max(1, Int(scenes[sceneIndex].seconds * Double(fps)))
    let hasNext = sceneIndex + 1 < scenes.count
    for localFrame in 0..<sceneFrames {
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.003) }
        let remaining = sceneFrames - localFrame
        let shouldFade = hasNext && remaining <= fadeFrames
        let blend: CGFloat = shouldFade ? CGFloat(fadeFrames - remaining + 1) / CGFloat(fadeFrames) : 0
        let clickStart = sceneFrames - fadeFrames - 8
        let clickProgress: CGFloat
        if localFrame >= clickStart && localFrame < sceneFrames - fadeFrames {
            clickProgress = CGFloat(localFrame - clickStart) / 8.0
        } else { clickProgress = 0 }
        let buffer = makePixelBuffer(
            current: images[sceneIndex],
            next: shouldFade ? images[sceneIndex + 1] : nil,
            blend: blend,
            cursor: scenes[sceneIndex].cursor,
            clickProgress: clickProgress
        )
        let time = CMTime(value: frameIndex, timescale: fps)
        guard adaptor.append(buffer, withPresentationTime: time) else {
            fatalError(writer.error?.localizedDescription ?? "Append failed")
        }
        frameIndex += 1
    }
}

input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Video failed") }
print(output.path)
print("duration=\(Double(frameIndex) / Double(fps)) seconds")
