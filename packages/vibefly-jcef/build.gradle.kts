plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij.platform.module")
}

group = "com.github.sandogeek.vibefly.jcef"
version = rootProject.version

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(kotlin("stdlib"))

    testImplementation("junit:junit:4.13.2")

    intellijPlatform {
        intellijIdea("2025.2.6.2")
    }
}

// vibefly-ui (Vite) → src/main/resources/web for ClasspathResourceHandler
val uiRoot = rootProject.layout.projectDirectory.dir("packages/vibefly-ui")
val webOut = layout.projectDirectory.dir("src/main/resources/web")

val buildVibeflyUi by tasks.registering(BuildVibeflyUiTask::class) {
    group = "build"
    description = "Build packages/vibefly-ui into vibefly-jcef web resources"
    // Override: -Pvibefly.bun=/opt/homebrew/bin/bun (IDE Gradle often lacks Homebrew PATH)
    bunCommand.set(providers.gradleProperty("vibefly.bun").orElse("bun"))
    workingDirectory.set(uiRoot)
    uiSourceDir.set(uiRoot.dir("src"))
    packageJson.set(uiRoot.file("package.json"))
    viteConfig.set(uiRoot.file("vite.config.ts"))
    indexHtml.set(uiRoot.file("index.html"))
    outputDir.set(webOut)
}

tasks.named("processResources") {
    dependsOn(buildVibeflyUi)
}
