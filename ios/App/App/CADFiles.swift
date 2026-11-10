import UIKit
import WebKit
import UniformTypeIdentifiers
import Capacitor

class CADViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CADFilesPlugin())
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--self-test") { runSmoke(attempt: 0) }
        #endif
    }
    override func didReceiveMemoryWarning() {
        super.didReceiveMemoryWarning()
        CADFilesPlugin.instance?.notifyListeners("memoryWarning", data: [:])
    }
    #if DEBUG
    private func runSmoke(attempt: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self = self, let web = self.webView else { return }
            web.evaluateJavaScript("Boolean(window.stepViewerMobile?.ready)") { ready, error in
                if ready as? Bool == true {
                    web.callAsyncJavaScript("return await window.stepViewerMobile.selfTest()", arguments: [:], in: nil, in: .page) { result in
                        switch result {
                        case .success(let value): self.report(value)
                        case .failure(let error): self.report(["ok": false, "error": error.localizedDescription])
                        }
                    }
                } else if attempt < 60 { self.runSmoke(attempt: attempt + 1) }
                else { self.report(["ok": false, "error": "Web app not ready: \(error?.localizedDescription ?? "unknown")"]) }
            }
        }
    }
    private func report(_ result: Any) {
        let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("native-smoke.json")
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: path) }
    }
    #endif
}

@objc(CADFilesPlugin)
public class CADFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "CADFilesPlugin"
    public let jsName = "CADFiles"
    public let pluginMethods: [CAPPluginMethod] = ["pick","describe","startup","begin","append","seal","finish","abort","setWorking","confirmClose"].compactMap { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    static weak var instance: CADFilesPlugin?
    static var incoming: [URL] = []
    private let io = DispatchQueue(label: "com.gilwookim.stepviewer.files", qos: .userInitiated)
    private let fm = FileManager.default
    private var known: [String: URL] = [:]
    private var pending: CAPPluginCall?
    private var exporting: String?
    private var ready = false
    private var queued: [[String: Any]] = []
    private struct Job { let folder: URL; let names: [String]; var sizes: [Int: Int] = [:]; var sealed: Set<Int> = [] }
    private var jobs: [String: Job] = [:]
    private lazy var root: URL = {
        let url = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("STEPViewerSession-" + UUID().uuidString)
        try? fm.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    public override func load() {
        Self.instance = self
        io.async {
            let caches = self.fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            let prefix = "STEPViewerSession-"
            for url in (try? self.fm.contentsOfDirectory(at: caches, includingPropertiesForKeys: nil)) ?? [] {
                let name = url.lastPathComponent
                if name.hasPrefix(prefix), UUID(uuidString: String(name.dropFirst(prefix.count))) != nil {
                    try? self.fm.removeItem(at: url)
                }
            }
        }
    }
    private func failure(_ text: String) -> NSError { NSError(domain: "CADFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func info(_ url: URL) throws -> [String: Any] {
        ["path": url.absoluteString, "name": url.lastPathComponent, "size": (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0]
    }
    private func copyImports(_ urls: [URL]) throws -> [[String: Any]] {
        var result: [[String: Any]] = []
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let size = (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
            guard size > 0 && size <= 512 * 1024 * 1024 else { throw failure("Use files up to 512 MB / 512MB 이하의 파일을 사용해 주세요.") }
            let folder = root.appendingPathComponent(UUID().uuidString)
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
            let dest = folder.appendingPathComponent(url.lastPathComponent)
            var coordinationError: NSError?, copyError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { source in
                do { try self.fm.copyItem(at: source, to: dest) } catch { copyError = error }
            }
            if let error = coordinationError { throw error }; if let error = copyError { throw error }
            known[dest.absoluteString] = dest
            result.append(try info(dest))
        }
        return result
    }
    func receive(_ urls: [URL]) {
        io.async {
            do {
                let files = try self.copyImports(urls)
                DispatchQueue.main.async {
                    if self.ready { self.notifyListeners("openFiles", data: ["files": files], retainUntilConsumed: true) }
                    else { self.queued.append(contentsOf: files) }
                }
            } catch { self.notifyListeners("openFiles", data: ["files": [["error": error.localizedDescription]]], retainUntilConsumed: true) }
        }
    }
    @objc func startup(_ call: CAPPluginCall) {
        let urls = Self.incoming; Self.incoming = []
        io.async {
            do {
                let files = try self.copyImports(urls)
                DispatchQueue.main.async { self.ready = true; let all = self.queued + files; self.queued = []; call.resolve(["files": all]) }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func describe(_ call: CAPPluginCall) {
        io.async {
            do {
                guard let path = call.getString("path"), let url = self.known[path] else { throw self.failure("Open this file again from Files.") }
                call.resolve(try self.info(url))
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil, let vc = self.bridge?.viewController, vc.presentedViewController == nil else { call.reject("A file dialog is already open."); return }
            self.pending = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data, .content], asCopy: true)
            picker.allowsMultipleSelection = true; picker.delegate = self; vc.present(picker, animated: true)
        }
    }
    @objc func begin(_ call: CAPPluginCall) {
        io.async {
            do {
                guard let names = call.getArray("names", String.self), !names.isEmpty, names.count <= 10000,
                      Set(names).count == names.count, names.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") && !$0.contains("\\") && !$0.contains("\0") }) else { throw self.failure("Invalid output names.") }
                let token = UUID().uuidString, folder = self.root.appendingPathComponent(token)
                try self.fm.createDirectory(at: folder, withIntermediateDirectories: true)
                self.jobs[token] = Job(folder: folder, names: names); call.resolve(["token": token])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func append(_ call: CAPPluginCall) {
        io.async {
            do {
                guard let token = call.getString("token"), var job = self.jobs[token], let index = call.getInt("index"), job.names.indices.contains(index), !job.sealed.contains(index),
                      let encoded = call.getString("data"), encoded.utf8.count <= 2 * 1024 * 1024,
                      let data = Data(base64Encoded: encoded) else { throw self.failure("Invalid file chunk.") }
                let size = (job.sizes[index] ?? 0) + data.count
                guard size <= 2 * 1024 * 1024 * 1024 else { throw self.failure("Output exceeds 2 GB. Export fewer parts.") }
                let url = job.folder.appendingPathComponent(job.names[index])
                if job.sizes[index] == nil { guard self.fm.createFile(atPath: url.path, contents: nil) else { throw self.failure("Cannot create output.") } }
                let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
                try handle.seekToEnd(); try handle.write(contentsOf: data)
                job.sizes[index] = size; self.jobs[token] = job; call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func seal(_ call: CAPPluginCall) {
        io.async {
            guard let token = call.getString("token"), var job = self.jobs[token], let index = call.getInt("index"), (job.sizes[index] ?? 0) > 0 else { call.reject("Empty output."); return }
            job.sealed.insert(index); self.jobs[token] = job; call.resolve(["size": job.sizes[index] ?? 0])
        }
    }
    @objc func finish(_ call: CAPPluginCall) {
        io.async {
            guard let token = call.getString("token"), let job = self.jobs[token], !job.sealed.isEmpty else { call.reject("No completed files to export."); return }
            let urls = job.sealed.sorted().map { job.folder.appendingPathComponent(job.names[$0]) }
            DispatchQueue.main.async {
                guard self.pending == nil, let vc = self.bridge?.viewController, vc.presentedViewController == nil else { call.reject("A file dialog is already open."); return }
                self.pending = call; self.exporting = token
                let picker = UIDocumentPickerViewController(forExporting: urls, asCopy: true)
                picker.delegate = self; vc.present(picker, animated: true)
            }
        }
    }
    private func cleanup(_ token: String) { io.async { if let job = self.jobs.removeValue(forKey: token) { try? self.fm.removeItem(at: job.folder) } } }
    @objc func abort(_ call: CAPPluginCall) { if let token = call.getString("token") { cleanup(token) }; call.resolve() }
    @objc func setWorking(_ call: CAPPluginCall) { DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = call.getBool("value") ?? false; call.resolve() } }
    @objc func confirmClose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let dialog = UIAlertController(title: call.getString("name"), message: "Save changes? / 변경 내용을 저장할까요?", preferredStyle: .alert)
            for (title, choice, style) in [("Save / 저장", "save", UIAlertAction.Style.default), ("Discard / 저장 안 함", "discard", .destructive), ("Cancel / 취소", "cancel", .cancel)] {
                dialog.addAction(UIAlertAction(title: title, style: style) { _ in call.resolve(["choice": choice]) })
            }
            self.bridge?.viewController.present(dialog, animated: true)
        }
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }; pending = nil
        if let token = exporting { exporting = nil; cleanup(token); call.resolve(["saved": true]); return }
        io.async { do { call.resolve(["files": try self.copyImports(urls)]) } catch { call.reject(error.localizedDescription) } }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let call = pending; pending = nil
        if let token = exporting { exporting = nil; cleanup(token); call?.resolve(["saved": false]) }
        else { call?.resolve(["files": []]) }
    }
}
