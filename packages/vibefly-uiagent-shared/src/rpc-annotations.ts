/**
 * Marks an abstract class as an RPC service contract.
 * Optional `name` overrides the wire service name (defaults to the class name).
 */
export function rpcService(name?: string) {
  void name
  return function <Class extends abstract new (...args: never) => unknown>(
    value: Class,
    _context: ClassDecoratorContext<Class>,
  ): Class {
    return value
  }
}

/**
 * Assigns a stable wire method id. Ids must be unique within a service.
 */
export function rpcId(id: number) {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
    throw new TypeError(
      `rpcId expects a non-negative safe integer, got ${String(id)}`,
    )
  }
  return function <This, Args extends unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
    _context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ): (this: This, ...args: Args) => Return {
    return value
  }
}
