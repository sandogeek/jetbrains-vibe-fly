plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
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
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")

    testImplementation("junit:junit:4.13.2")

    intellijPlatform {
        intellijIdea("2025.2.6.2")
    }
}

// packages/vibefly-ui/src/generated/rpc.ts from Ui2Host + Host2Ui
val uiRpcTs = rootProject.layout.projectDirectory.file("packages/vibefly-ui/src/generated/rpc.ts")

val generateVibeflyUiRpc by tasks.registering(JavaExec::class) {
    group = "build"
    description = "Generate vibefly-ui SimpleRpc TypeScript contracts from Ui2Host/Host2Ui"
    dependsOn(tasks.named("compileKotlin"))
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.github.sandogeek.vibefly.jcef.rpc.GenerateUiRpcKt")
    args(uiRpcTs.asFile.absolutePath)
    inputs.files(sourceSets["main"].allSource)
    outputs.file(uiRpcTs)
}

// packages/vibefly-agent/src/generated/controlRpc.ts from Host2Agent
val agentControlRpcTs =
    rootProject.layout.projectDirectory.file("packages/vibefly-agent/src/generated/controlRpc.ts")

val generateVibeflyAgentControlRpc by tasks.registering(JavaExec::class) {
    group = "build"
    description = "Generate vibefly-agent SimpleRpc control contracts from Host2Agent"
    dependsOn(tasks.named("compileKotlin"))
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.github.sandogeek.vibefly.jcef.rpc.GenerateAgentControlRpcKt")
    args(agentControlRpcTs.asFile.absolutePath)
    inputs.files(sourceSets["main"].allSource)
    outputs.file(agentControlRpcTs)
}

// Build-time provider data for UI + Agent (committed generated TS; re-export when upgrading).
val agentRoot = rootProject.layout.projectDirectory.dir("packages/vibefly-agent")
val uiProviderCatalog =
    rootProject.layout.projectDirectory.file("packages/vibefly-ui/src/generated/bundledCatalog.ts")
val agentProviderCatalog =
    rootProject.layout.projectDirectory.file("packages/vibefly-agent/src/generated/providerCatalog.ts")

val exportBundledCatalog by tasks.registering(ExportBundledCatalogTask::class) {
    group = "build"
    description = "Export immutable provider data from Agent dependencies into generated TS modules"
    nodeCommand.set(providers.gradleProperty("vibefly.node").orElse("node"))
    workingDirectory.set(agentRoot)
    packageJson.set(agentRoot.file("package.json"))
    exportScript.set(agentRoot.file("scripts/export-bundled-catalog.ts"))
    // Always register the path: missing file → empty input; install/upgrade → out-of-date.
    upstreamPackageInputs.from(
        agentRoot.file("node_modules/@earendil-works/pi-coding-agent/package.json"),
        agentRoot.file("node_modules/@earendil-works/pi-ai/package.json"),
    )
    uiOutputFile.set(uiProviderCatalog)
    agentOutputFile.set(agentProviderCatalog)
}

// vibefly-ui (Vite) → src/main/resources/web for ClasspathResourceHandler
// Dev (-Pvibefly.ui.dev=true / -Pvibefly.ui.dev.url=...): JCEF loads Vite; skip npm run build
val uiDevMode =
    findProperty("vibefly.ui.dev")?.toString() == "true" ||
        !findProperty("vibefly.ui.dev.url")?.toString()?.trim().isNullOrEmpty()

val uiRoot = rootProject.layout.projectDirectory.dir("packages/vibefly-ui")
val webOut = layout.projectDirectory.dir("src/main/resources/web")

val buildVibeflyUi by tasks.registering(BuildVibeflyUiTask::class) {
    group = "build"
    description = "Build packages/vibefly-ui into vibefly-jcef web resources"
    // Override: -Pvibefly.node=/opt/homebrew/bin/node (IDE Gradle often lacks Homebrew PATH)
    dependsOn(exportBundledCatalog)
    nodeCommand.set(providers.gradleProperty("vibefly.node").orElse("node"))
    workingDirectory.set(uiRoot)
    uiSourceDir.set(uiRoot.dir("src"))
    packageJson.set(uiRoot.file("package.json"))
    viteConfig.set(uiRoot.file("vite.config.ts"))
    indexHtml.set(uiRoot.file("index.html"))
    providerCatalog.set(uiProviderCatalog)
    outputDir.set(webOut)
}

// Dev: JCEF loads Vite — skip npm run build, but still refresh generated provider data.
if (!uiDevMode) {
    tasks.named("processResources") {
        dependsOn(buildVibeflyUi)
    }
} else {
    tasks.named("processResources") {
        dependsOn(exportBundledCatalog)
    }
    logger.lifecycle(
        "vibefly.ui.dev enabled: skip :vibefly-jcef:buildVibeflyUi " +
            "(JCEF loads Vite; start with ./gradlew runVibeflyUiDev)",
    )
}
