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
}
