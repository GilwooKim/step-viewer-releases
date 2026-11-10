import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CADViewController()
        window?.makeKeyAndVisible()

        CADFilesPlugin.incoming.append(contentsOf: connectionOptions.urlContexts.map(\.url).filter(\.isFileURL))
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let urls = URLContexts.map(\.url).filter(\.isFileURL)
        if let plugin = CADFilesPlugin.instance { plugin.receive(urls) }
        else { CADFilesPlugin.incoming.append(contentsOf: urls) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
