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
    implementation(project(":vibefly-simplerpc"))

    testImplementation("junit:junit:4.13.2")

    intellijPlatform {
        intellijIdea("2025.2.6.2")
    }
}

// packages/vibefly-ui/src/generated/rpc.ts from HostApi + WebApi
val uiRpcTs = rootProject.layout.projectDirectory.file("packages/vibefly-ui/src/generated/rpc.ts")

val generateVibeflyUiRpc by tasks.registering(JavaExec::class) {
    group = "build"
    description = "Generate vibefly-ui SimpleRpc TypeScript contracts from HostApi/WebApi"
    dependsOn(tasks.named("compileKotlin"))
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.github.sandogeek.vibefly.jcef.rpc.GenerateUiRpcKt")
    args(uiRpcTs.asFile.absolutePath)
    inputs.files(sourceSets["main"].allSource)
    outputs.file(uiRpcTs)
}

// vibefly-ui (Vite) → src/main/resources/web for ClasspathResourceHandler
// Dev (-Pvibefly.ui.dev=true / -Pvibefly.ui.dev.url=...): JCEF loads Vite; skip bun run build
val uiDevMode =
    findProperty("vibefly.ui.dev")?.toString() == "true" ||
        !findProperty("vibefly.ui.dev.url")?.toString()?.trim().isNullOrEmpty()

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

// Dev: JCEF loads Vite — do not wire bun run build into processResources
if (!uiDevMode) {
    tasks.named("processResources") {
        dependsOn(buildVibeflyUi)
    }
} else {
    logger.lifecycle(
        "vibefly.ui.dev enabled: skip :vibefly-jcef:buildVibeflyUi " +
            "(JCEF loads Vite; start with ./gradlew runVibeflyUiDev)",
    )
}
