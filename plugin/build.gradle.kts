import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask

plugins {
    id("org.jetbrains.kotlin.jvm")
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
    implementation(project(":vibefly-jcef"))

    testImplementation("junit:junit:4.13.2")

    // IntelliJ Platform Gradle Plugin Dependencies Extension - read more: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-dependencies-extension.html
    intellijPlatform {
        intellijIdea("2025.2.6.2")
        testFramework(TestFrameworkType.Platform)
    }
}

changelog {
    path.set(rootProject.file("CHANGELOG.md").canonicalPath)
}

// Vite HMR: ./gradlew :plugin:runIde -Pvibefly.ui.dev=true
// Optional: -Pvibefly.ui.dev.url=http://127.0.0.1:5173/
// When ui.dev is on, ensureVibeflyUiDevServer starts `bun run dev` if the port is free.
// Dev also skips :vibefly-jcef:buildVibeflyUi (no bun run build).
val isUiDevMode =
    findProperty("vibefly.ui.dev")?.toString() == "true" ||
        !findProperty("vibefly.ui.dev.url")?.toString()?.trim().isNullOrEmpty()

val resolvedUiDevUrl =
    findProperty("vibefly.ui.dev.url")?.toString()?.trim().orEmpty()
        .ifEmpty { EnsureVibeflyUiDevServerTask.DEFAULT_DEV_URL }

val ensureVibeflyUiDevServer by tasks.registering(EnsureVibeflyUiDevServerTask::class) {
    group = "run"
    description = "Start packages/vibefly-ui `bun run dev` if not already listening"
    uiDevEnabled.set(isUiDevMode)
    bunCommand.set(providers.gradleProperty("vibefly.bun").orElse("bun"))
    workingDirectory.set(rootProject.layout.projectDirectory.dir("packages/vibefly-ui"))
    devUrl.set(resolvedUiDevUrl)
    readyTimeoutSeconds.set(60)
    logFile.set(rootProject.layout.buildDirectory.file("vibefly-ui-dev.log"))
}

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
        dependsOn(ensureVibeflyUiDevServer)
    }
}
