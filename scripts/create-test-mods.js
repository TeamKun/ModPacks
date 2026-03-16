/**
 * Generates minimal test MOD JARs for smoke testing.
 * Each JAR contains only metadata (no Java code).
 *
 * Usage: node scripts/create-test-mods.js
 * Requires: jar command (JDK) in PATH or at standard install location
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

// Find jar executable
function findJar() {
    try {
        execSync('jar --version', { stdio: 'ignore' })
        return 'jar'
    } catch {
        // Try standard Windows JDK locations
        const javaBase = 'C:\\Program Files\\Java'
        if (fs.existsSync(javaBase)) {
            const jdks = fs.readdirSync(javaBase).filter(d => d.startsWith('jdk'))
            if (jdks.length > 0) {
                const jarPath = path.join(javaBase, jdks[jdks.length - 1], 'bin', 'jar')
                if (fs.existsSync(jarPath + '.exe') || fs.existsSync(jarPath)) {
                    return `"${jarPath}"`
                }
            }
        }
        throw new Error('jar command not found. Install a JDK.')
    }
}

const JAR = findJar()
const SERVERS_DIR = path.resolve(__dirname, '..', 'servers')

// --- Forge servers (mcmod.info for 1.7/1.12, mods.toml for 1.13+) ---

const forgeServers = [
    { id: 'test-forge-1.7.10', mc: '1.7.10', format: 'mcmod.info' },
    { id: 'test-forge-1.12.2', mc: '1.12.2', format: 'mcmod.info' },
    { id: 'test-forge-1.16.5', mc: '1.16.5', format: 'mods.toml' },
    { id: 'test-forge-1.19.2', mc: '1.19.2', format: 'mods.toml' },
    { id: 'test-forge-1.20.1', mc: '1.20.1', format: 'mods.toml' },
    { id: 'test-forge-1.20.4', mc: '1.20.4', format: 'mods.toml' },
    { id: 'test-forge-1.21.1', mc: '1.21.1', format: 'mods.toml' },
]

// --- Fabric servers ---

const fabricServers = [
    { id: 'test-fabric-1.16.5', mc: '1.16.5' },
    { id: 'test-fabric-1.19.2', mc: '1.19.2' },
    { id: 'test-fabric-1.20.1', mc: '1.20.1' },
    { id: 'test-fabric-1.20.4', mc: '1.20.4' },
    { id: 'test-fabric-1.21.1', mc: '1.21.1' },
]

function mcmodInfo(mcVersion) {
    return JSON.stringify([{
        modid: 'numatest',
        name: 'NumaTest',
        version: '1.0.0',
        description: 'Smoke test mod',
        mcversion: mcVersion
    }], null, 2)
}

function modsToml() {
    return `modLoader = "lowcodelanguage"
loaderVersion = "[1,)"
license = "MIT"

[[mods]]
modId = "numatest"
version = "1.0.0"
displayName = "NumaTest"
description = "Smoke test mod"
`
}

function fabricModJson() {
    return JSON.stringify({
        schemaVersion: 1,
        id: 'numatest',
        version: '1.0.0',
        name: 'NumaTest',
        description: 'Smoke test mod',
        environment: '*'
    }, null, 2)
}

function createJar(tmpDir, jarPath) {
    // Use jar command to create JAR from tmpDir contents
    execSync(`${JAR} cf "${jarPath}" -C "${tmpDir}" .`, { stdio: 'inherit' })
}

// Create Forge mod JARs
for (const srv of forgeServers) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'numatest-'))
    const jarName = `numatest-${srv.mc}.jar`
    const jarDest = path.join(SERVERS_DIR, srv.id, 'forgemods', 'required', jarName)

    if (srv.format === 'mcmod.info') {
        fs.writeFileSync(path.join(tmpDir, 'mcmod.info'), mcmodInfo(srv.mc))
    } else {
        const metaInf = path.join(tmpDir, 'META-INF')
        fs.mkdirSync(metaInf)
        fs.writeFileSync(path.join(metaInf, 'mods.toml'), modsToml())
    }

    createJar(tmpDir, jarDest)
    fs.rmSync(tmpDir, { recursive: true })
    console.log(`Created: ${jarName} -> ${srv.id}`)
}

// Create Fabric mod JARs
for (const srv of fabricServers) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'numatest-'))
    const jarName = `numatest-fabric-${srv.mc}.jar`
    const jarDest = path.join(SERVERS_DIR, srv.id, 'fabricmods', 'required', jarName)

    fs.writeFileSync(path.join(tmpDir, 'fabric.mod.json'), fabricModJson())

    createJar(tmpDir, jarDest)
    fs.rmSync(tmpDir, { recursive: true })
    console.log(`Created: ${jarName} -> ${srv.id}`)
}

console.log('\nDone! All test mod JARs created.')
