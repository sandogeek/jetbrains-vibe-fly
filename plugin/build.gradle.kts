import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.intellij.platform")
    id("org.jetbrains.changelog")
}

group = providers.gradleProperty("group").get()
version = rootProject.version

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":vibefly-simplerpc"))
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")

    testImplementation("junit:junit:4.13.2")

    // IntelliJ Platform Gradle Plugin Dependencies Extension - read more: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-dependencies-extension.html
    intellijPlatform {
        intellijIdea("2025.2.6.2")
        testFramework(TestFrameworkType.Platform)
        // vibefly-jcef is a platform.module subproject. Plain implementation() packages it under
        // lib/modules/ only; without a plugin.xml content-module entry that is not on the main
        // PluginClassLoader (NoClassDefFoundError for AgentOrigin / VibeflyBrowserPanel, etc.).
        // Compose into the main plugin JAR so host code can reference jcef types directly.
        pluginComposedModule(implementation(project(":vibefly-jcef")))
    }
}

changelog {
    path.set(rootProject.file("CHANGELOG.md").canonicalPath)
}

intellijPlatform {
    // Headless searchable-options requires a free sandbox IDE lock; skip for local/installable builds.
    // Settings search still works without the prebuilt index.
    buildSearchableOptions = false
    pluginConfiguration {
        // com.intellij.modules.jcef exists as a product module from 2025.3;
        // in 2026.2+ it is a separate plugin that must be on PluginClassLoader parents.
        ideaVersion {
            sinceBuild = "253"
        }
    }
}

// Production agent runtime staged under plugin/agent/ and copied into the installable zip.
val vibeflyAgentBundleDir = layout.buildDirectory.dir("bundled-agent")

val buildVibeflyAgent by tasks.registering(BuildVibeflyAgentTask::class) {
    group = "build"
    description = "Build and stage production vibefly-agent runtime for the plugin distribution"
    bunCommand.set(providers.gradleProperty("vibefly.bun").orElse("bun"))
    agentRootDir.set(rootProject.layout.projectDirectory.dir("packages/vibefly-agent"))
    agentSourceDir.set(rootProject.layout.projectDirectory.dir("packages/vibefly-agent/src"))
    agentPackageJson.set(rootProject.layout.projectDirectory.file("packages/vibefly-agent/package.json"))
    agentTsconfig.set(rootProject.layout.projectDirectory.file("packages/vibefly-agent/tsconfig.json"))
    simpleRpcTsDir.set(rootProject.layout.projectDirectory.dir("packages/vibefly-simplerpc/typeScript"))
    simpleRpcBunDir.set(rootProject.layout.projectDirectory.dir("packages/vibefly-simplerpc/typeScript-bun"))
    uiagentSharedDir.set(rootProject.layout.projectDirectory.dir("packages/vibefly-uiagent-shared"))
    dependencyMarkers.from(
        rootProject.layout.projectDirectory.file("packages/vibefly-agent/package.json"),
        rootProject.layout.projectDirectory.file("packages/vibefly-agent/bun.lock"),
        rootProject.layout.projectDirectory.file("packages/vibefly-simplerpc/typeScript/package.json"),
        rootProject.layout.projectDirectory.file("packages/vibefly-simplerpc/typeScript-bun/package.json"),
        rootProject.layout.projectDirectory.file("packages/vibefly-uiagent-shared/package.json"),
        rootProject.layout.projectDirectory.dir("packages/vibefly-simplerpc/typeScript/src"),
        rootProject.layout.projectDirectory.dir("packages/vibefly-simplerpc/typeScript-bun/src"),
        rootProject.layout.projectDirectory.dir("packages/vibefly-uiagent-shared/src"),
    )
    outputDir.set(vibeflyAgentBundleDir)
}

tasks.named<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>("prepareSandbox") {
    dependsOn(buildVibeflyAgent)
    from(vibeflyAgentBundleDir) {
        into(providers.provider {
            // PrepareSandboxTask copies relative to plugins/<projectName>/
            val name = project.extensions
                .getByType(org.jetbrains.intellij.platform.gradle.extensions.IntelliJPlatformExtension::class.java)
                .projectName.get()
            "$name/agent"
        })
    }
}

// Vite HMR: ./gradlew :plugin:runIde -Pvibefly.ui.dev=true
// Optional: -Pvibefly.ui.dev.url=http://127.0.0.1:5173/
// runIde waits for the Vite port (no auto-start). Use IDE "Run UI Dev" / Compound, or bun run dev.
// Dev also skips :vibefly-jcef:buildVibeflyUi (no bun run build).
val isUiDevMode =
    findProperty("vibefly.ui.dev")?.toString() == "true" ||
        !findProperty("vibefly.ui.dev.url")?.toString()?.trim().isNullOrEmpty()

val resolvedUiDevUrl =
    findProperty("vibefly.ui.dev.url")?.toString()?.trim().orEmpty()
        .ifEmpty { WaitVibeflyUiDevServerTask.DEFAULT_DEV_URL }

val waitVibeflyUiDevServer by tasks.registering(WaitVibeflyUiDevServerTask::class) {
    group = "run"
    description = "Wait until packages/vibefly-ui Vite dev server is listening"
    uiDevEnabled.set(isUiDevMode)
    devUrl.set(resolvedUiDevUrl)
    readyTimeoutSeconds.set(60)
}

// Debug: Bun agent inspect + JCEF WebView CDP
//   ./gradlew :plugin:runIde -Pvibefly.debug=true
//   or selectively: -Pvibefly.agent.inspect=6499 -Pvibefly.jcef.debug.port=9222
// Defaults when -Pvibefly.debug=true: agent inspect 6499, JCEF CDP 9222, internal mode.
// Bun agent (requires JetBrains Bun plugin):
//   - Debug Bun Agent → launch packages/vibefly-agent/src/main.ts
// Plugin-spawned --inspect: use debug.bun.sh or VS Code Attach (Bun plugin has no attach type).
tasks.named<RunIdeTask>("runIde") {
    val dev = findProperty("vibefly.ui.dev")?.toString()
    if (dev == "true") {
        jvmArgs("-Dvibefly.ui.dev=true")
    }
    val devUrlProp = findProperty("vibefly.ui.dev.url")?.toString()?.trim().orEmpty()
    if (devUrlProp.isNotEmpty()) {
        jvmArgs("-Dvibefly.ui.dev.url=$devUrlProp")
    }
    if (isUiDevMode) {
        dependsOn(waitVibeflyUiDevServer)
    }

    // Sandbox IDE user.dir is not the monorepo root; pin agent entry absolutely.
    // Override: -Pvibefly.agent.entry=/abs/path/to/main.ts
    val agentEntryOverride = findProperty("vibefly.agent.entry")?.toString()?.trim().orEmpty()
    val agentEntry = agentEntryOverride.ifEmpty {
        val src = rootProject.layout.projectDirectory
            .file("packages/vibefly-agent/src/main.ts").asFile
        val dist = rootProject.layout.projectDirectory
            .file("packages/vibefly-agent/dist/main.js").asFile
        when {
            src.isFile -> src.absolutePath
            dist.isFile -> dist.absolutePath
            else -> src.absolutePath
        }
    }
    logger.lifecycle("agentEntry=$agentEntry")
    jvmArgs("-Dvibefly.agent.entry=$agentEntry")

    val debugAll = findProperty("vibefly.debug")?.toString() == "true"
    val agentInspect = findProperty("vibefly.agent.inspect")?.toString()?.trim().orEmpty()
        .ifEmpty { if (debugAll) "6499" else "" }
    if (agentInspect.isNotEmpty()) {
        jvmArgs("-Dvibefly.agent.inspect=$agentInspect")
        val inspectMode = findProperty("vibefly.agent.inspect.mode")?.toString()?.trim().orEmpty()
        if (inspectMode.isNotEmpty()) {
            jvmArgs("-Dvibefly.agent.inspect.mode=$inspectMode")
        }
    }
    val jcefDebugPort = findProperty("vibefly.jcef.debug.port")?.toString()?.trim().orEmpty()
        .ifEmpty { if (debugAll) "9222" else "" }
    if (jcefDebugPort.isNotEmpty()) {
        // Registry-compatible system properties (see IntelliJ JCEF debugging docs).
        jvmArgs("-Dide.browser.jcef.debug.port=$jcefDebugPort")
        jvmArgs("-Dide.browser.jcef.contextMenu.devTools.enabled=true")
    }
    if (debugAll) {
        // Enables JCEF context-menu "Open DevTools" in the sandbox IDE.
        jvmArgs("-Didea.is.internal=true")
    }
}
