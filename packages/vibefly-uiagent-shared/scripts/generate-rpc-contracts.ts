import {mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, relative, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import ts from "typescript"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const defaultInput = resolve(packageRoot, "src/contracts.ts")
const defaultOutput = resolve(packageRoot, "src/contracts.generated.ts")

export type RpcContractMethod = {
    name: string
    id: number
}

export type RpcContract = {
    interfaceName: string
    serviceName: string
    methods: RpcContractMethod[]
}

type FoundDecorator = {
    decorator: ts.Decorator
    args: readonly ts.Expression[]
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`
}

function fail(sourceFile: ts.SourceFile, node: ts.Node, message: string): never {
    throw new Error(`${location(sourceFile, node)}: ${message}`)
}

function isExported(node: ts.HasModifiers): boolean {
    return (
        node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) === true
    )
}

function hasModifier(node: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
    return node.modifiers?.some((modifier) => modifier.kind === kind) === true
}

function propertyName(
    sourceFile: ts.SourceFile,
    node: ts.PropertyName,
): string {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
    fail(sourceFile, node, "RPC method names must be identifiers or string literals")
}

function nodeDecorators(node: ts.Node): readonly ts.Decorator[] {
    if (typeof ts.canHaveDecorators === "function" && ts.canHaveDecorators(node)) {
        return ts.getDecorators(node) ?? []
    }
    return (
        (node as ts.Node & { decorators?: readonly ts.Decorator[] }).decorators ?? []
    )
}

function findDecorator(node: ts.Node, name: string): FoundDecorator | null {
    for (const decorator of nodeDecorators(node)) {
        const expression = decorator.expression
        if (ts.isIdentifier(expression) && expression.text === name) {
            return {decorator, args: []}
        }
        if (
            ts.isCallExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            expression.expression.text === name
        ) {
            return {decorator, args: expression.arguments}
        }
    }
    return null
}

function readServiceName(
    sourceFile: ts.SourceFile,
    className: string,
    serviceDecorator: FoundDecorator,
): string {
    if (serviceDecorator.args.length === 0) return className
    if (serviceDecorator.args.length > 1) {
        fail(
            sourceFile,
            serviceDecorator.decorator,
            "@rpcService accepts at most one string literal argument",
        )
    }
    const arg = serviceDecorator.args[0]
    if (arg == null) {
        fail(sourceFile, serviceDecorator.decorator, "@rpcService name is missing")
    }
    if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
        fail(sourceFile, arg, "@rpcService name must be a string literal")
    }
    return arg.text
}

function readRpcId(
    sourceFile: ts.SourceFile,
    methodName: string,
    idDecorator: FoundDecorator,
): number {
    if (idDecorator.args.length !== 1) {
        fail(
            sourceFile,
            idDecorator.decorator,
            `RPC method ${methodName} must use @rpcId(<id>)`,
        )
    }
    const arg = idDecorator.args[0]
    if (arg == null) {
        fail(
            sourceFile,
            idDecorator.decorator,
            `RPC method ${methodName} must use @rpcId(<id>)`,
        )
    }
    if (!ts.isNumericLiteral(arg)) {
        fail(
            sourceFile,
            arg,
            `RPC method ${methodName} has invalid @rpcId argument ${arg.getText(sourceFile)}`,
        )
    }
    const idText = arg.text
    if (!/^(0|[1-9]\d*)$/.test(idText)) {
        fail(
            sourceFile,
            arg,
            `RPC method ${methodName} has invalid @rpcId ${JSON.stringify(idText)}`,
        )
    }
    const id = Number(idText)
    if (!Number.isSafeInteger(id)) {
        fail(
            sourceFile,
            arg,
            `RPC method ${methodName} @rpcId is outside the safe integer range`,
        )
    }
    return id
}

/** Parse the authored TypeScript contract classes into runtime RPC metadata. */
export function parseRpcContracts(
    source: string,
    fileName = "contracts.ts",
): RpcContract[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    )

    const parseErrors =
        (
            sourceFile as ts.SourceFile & {
                parseDiagnostics?: readonly ts.Diagnostic[]
            }
        ).parseDiagnostics ?? []
    if (parseErrors.length > 0) {
        const diagnostic = parseErrors[0]
        if (diagnostic == null) {
            throw new Error(`${fileName}: unknown parse error`)
        }
        const start = diagnostic.start ?? 0
        const position = sourceFile.getLineAndCharacterOfPosition(start)
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        throw new Error(
            `${fileName}:${position.line + 1}:${position.character + 1}: ${message}`,
        )
    }

    const contracts: RpcContract[] = []
    for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement) || statement.name == null) continue
        const serviceDecorator = findDecorator(statement, "rpcService")
        if (serviceDecorator == null) continue
        if (!isExported(statement)) {
            fail(sourceFile, statement, "@rpcService classes must be exported")
        }
        if (!hasModifier(statement, ts.SyntaxKind.AbstractKeyword)) {
            fail(sourceFile, statement, "@rpcService classes must be abstract")
        }

        const interfaceName = statement.name.text
        const serviceName = readServiceName(sourceFile, interfaceName, serviceDecorator)
        const ids = new Map<number, string>()
        const names = new Set<string>()
        const methods: RpcContractMethod[] = []

        for (const member of statement.members) {
            if (ts.isConstructorDeclaration(member)) {
                fail(sourceFile, member, "RPC contract classes may not declare constructors")
            }
            if (!ts.isMethodDeclaration(member)) {
                fail(sourceFile, member, "RPC contracts may only contain method declarations")
            }
            if (hasModifier(member, ts.SyntaxKind.AbstractKeyword)) {
                // experimentalDecorators cannot attach to abstract methods / overloads.
                fail(
                    sourceFile,
                    member,
                    "RPC methods cannot be abstract; use a concrete method body (e.g. throw)",
                )
            }
            if (member.typeParameters != null) {
                fail(sourceFile, member, "generic RPC methods are not supported")
            }
            if (member.body == null) {
                fail(sourceFile, member, "RPC methods must have a method body")
            }

            const name = propertyName(sourceFile, member.name)
            if (names.has(name)) {
                fail(sourceFile, member, `duplicate RPC method name ${JSON.stringify(name)}`)
            }
            names.add(name)

            const idDecorator = findDecorator(member, "rpcId")
            if (idDecorator == null) {
                fail(sourceFile, member, `RPC method ${name} is missing @rpcId(<id>)`)
            }
            const id = readRpcId(sourceFile, name, idDecorator)
            const previousName = ids.get(id)
            if (previousName != null) {
                fail(
                    sourceFile,
                    member,
                    `duplicate @rpcId ${id} for ${previousName} and ${name}`,
                )
            }
            ids.set(id, name)
            methods.push({name, id})
        }

        if (methods.length === 0) {
            fail(sourceFile, statement, `RPC service ${interfaceName} has no methods`)
        }
        contracts.push({interfaceName, serviceName, methods})
    }

    if (contracts.length === 0) {
        throw new Error(`${fileName}: no exported @rpcService abstract classes found`)
    }
    return contracts
}

function lowerFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1)
}

function sourceModulePath(inputPath: string, outputPath: string): string {
    let modulePath = relative(dirname(outputPath), inputPath)
        .replaceAll("\\", "/")
        .replace(/\.(?:mts|cts|tsx|ts)$/, ".js")
    if (!modulePath.startsWith(".")) modulePath = `./${modulePath}`
    return modulePath
}

/** Emit SimpleRpc runtime definitions while deriving all method types from the contracts. */
export function emitRpcContracts(
    contracts: readonly RpcContract[],
    contractModule = "./contracts.js",
): string {
    const lines = [
        "/* eslint-disable */",
        "/* Generated from contracts.ts by generate-rpc-contracts.ts. Do not edit. */",
        "",
        "import {",
        "  defineRpcService,",
        "  rpcMethod,",
        "  type RpcMethodArgs,",
        "  type RpcService,",
        "  type SimpleRpcPeer,",
        '} from "@sandogeek/simple-rpc"',
        "import type {",
    ]

    for (const contract of contracts) {
        lines.push(
            `  ${contract.interfaceName} as ${contract.interfaceName}Contract,`,
        )
    }
    lines.push(`} from ${JSON.stringify(contractModule)}`, "")

    for (const contract of contracts) {
        const {interfaceName, methods, serviceName} = contract
        const definitionName = lowerFirst(interfaceName)
        const contractType = `${interfaceName}Contract`
        lines.push(
            `export const ${definitionName} = defineRpcService(${JSON.stringify(serviceName)}, {`,
        )
        for (const method of methods) {
            const key = JSON.stringify(method.name)
            lines.push(
                `  ${key}: rpcMethod<`,
                `    RpcMethodArgs<${contractType}[${key}]>,`,
                `    Awaited<ReturnType<${contractType}[${key}]>>`,
                `  >(${method.id}),`,
            )
        }
        lines.push(
            "})",
            "",
            `export type ${interfaceName}Service = RpcService<typeof ${definitionName}>`,
            "",
            `export function create${interfaceName}Proxy(peer: SimpleRpcPeer): ${contractType} {`,
            `  return ${definitionName}.createProxy(peer)`,
            "}",
            `export const register${interfaceName}Service = ${definitionName}.register`,
            "",
        )
    }

    return `${lines.join("\n").trimEnd()}\n`
}

export function generateRpcContracts(
    inputPath: string,
    outputPath: string,
    check = false,
): void {
    const source = readFileSync(inputPath, "utf8")
    const contracts = parseRpcContracts(source, inputPath)
    const output = emitRpcContracts(
        contracts,
        sourceModulePath(inputPath, outputPath),
    )

    if (check) {
        let current: string | null = null
        try {
            current = readFileSync(outputPath, "utf8")
        } catch {
            // Report a stale generated file below.
        }
        if (current !== output) {
            throw new Error(
                `${outputPath} is stale; run "npm run generate" in ${packageRoot}`,
            )
        }
        return
    }

    mkdirSync(dirname(outputPath), {recursive: true})
    writeFileSync(outputPath, output)
}

function main(args: string[]): void {
    const check = args.includes("--check")
    const paths = args.filter((arg) => arg !== "--check")
    if (paths.length > 2) {
        throw new Error("Usage: generate-rpc-contracts.ts [input] [output] [--check]")
    }
    const inputPath = resolve(packageRoot, paths[0] ?? defaultInput)
    const outputPath = resolve(packageRoot, paths[1] ?? defaultOutput)
    generateRpcContracts(inputPath, outputPath, check)
    if (!check) console.log(`Wrote ${outputPath}`)
}

const entryPath =
    process.argv[1] == null ? null : pathToFileURL(resolve(process.argv[1])).href
if (entryPath === import.meta.url) {
    try {
        main(process.argv.slice(2))
    } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    }
}
