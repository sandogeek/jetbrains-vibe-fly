// Root aggregator — IntelliJ plugin lives in :plugin (peer of :vibefly-simplerpc)

// Vite HMR: ./gradlew runVibeflyUiDev  (IDE run config "Run UI Dev")
tasks.register<RunVibeflyUiDevServerTask>("runVibeflyUiDev") {
    group = "run"
    description = "Start packages/vibefly-ui Vite dev server (npm run dev)"
    nodeCommand.set(providers.gradleProperty("vibefly.node").orElse("node"))
    workingDirectory.set(layout.projectDirectory.dir("packages/vibefly-ui"))
    devUrl.set(
        providers.gradleProperty("vibefly.ui.dev.url")
            .orElse(WaitVibeflyUiDevServerTask.DEFAULT_DEV_URL),
    )
}
