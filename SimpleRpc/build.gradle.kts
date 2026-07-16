plugins {
    id("org.jetbrains.kotlin.jvm")
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
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation(kotlin("test-junit"))
    testImplementation("junit:junit:4.13.2")
}
