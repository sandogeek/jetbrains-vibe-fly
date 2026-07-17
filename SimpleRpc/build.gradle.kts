plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

group = "com.github.sandogeek.simplerpc"
version = rootProject.version

kotlin {
    jvmToolchain(21)
}

java {
    withSourcesJar()
}

// Root sets kotlin.stdlib.default.dependency=false for the IntelliJ plugin; SimpleRpc needs stdlib.
dependencies {
    implementation(kotlin("stdlib"))
    implementation(kotlin("reflect"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")

    testImplementation(kotlin("test-junit"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
