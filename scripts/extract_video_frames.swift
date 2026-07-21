import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let videoURL = root.appendingPathComponent("artifacts/charge-queue-mock.mp4")
let outputDirectory = root.appendingPathComponent("artifacts/mock-video")
let asset = AVURLAsset(url: videoURL)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

for (index, seconds) in [0.5, 11.8, 22.0].enumerated() {
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    var actual = CMTime.zero
    let image = try generator.copyCGImage(at: time, actualTime: &actual)
    let output = outputDirectory.appendingPathComponent("preview-\(index + 1).png")
    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Could not create preview")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Could not save preview") }
    print(output.path)
}
