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

// Vite HMR: ./gradlew :plugin:runIde -Pvibefly.ui.dev=true  (also start: cd packages/vibefly-ui && bun run dev)
// Optional: -Pvibefly.ui.dev.url=http://127.0.0.1:5173/
// Dev also skips :vibefly-jcef:buildVibeflyUi (no bun run build).
tasks.named<RunIdeTask>("runIde") {
    val dev = findProperty("vibefly.ui.dev")?.toString()
    if (dev == "true") {
        jvmArgs("-Dvibefly.ui.dev=true")
    }
    val devUrl = findProperty("vibefly.ui.dev.url")?.toString()?.trim().orEmpty()
    if (devUrl.isNotEmpty()) {
        jvmArgs("-Dvibefly.ui.dev.url=$devUrl")
    }
}
