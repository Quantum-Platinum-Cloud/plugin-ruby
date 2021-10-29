import type { Plugin, Ruby } from "../types";

function isPeriod(node: Ruby.CallOperator) {
  // Older versions of Ruby didn't have a @period ripper event, so we need to
  // explicitly cast to any here.
  if (node === "::" || (node as any) === ".") {
    return true;
  }

  return node.type === "@period";
}

// If you have a simple block that only calls a method on the single required
// parameter that is passed to it, then you can replace that block with the
// simpler `Symbol#to_proc`. Meaning, it would go from:
//
//     [1, 2, 3].map { |i| i.to_s }
//
// to:
//
//     [1, 2, 3].map(&:to_s)
//
// This works with `do` blocks as well.
function toProc(
  path: Plugin.Path<Ruby.Args | Ruby.MethodAddBlock>,
  node: Ruby.BraceBlock | Ruby.DoBlock
) {
  // Ensure that there are variables being passed to this block.
  const params = node.block_var && node.block_var.params;
  if (!params) {
    return null;
  }

  // Ensure there is one and only one parameter, and that it is required.
  const [reqParams, ...otherParams] = params.body;
  if (
    !Array.isArray(reqParams) ||
    reqParams.length !== 1 ||
    otherParams.some(Boolean)
  ) {
    return null;
  }

  let statements: Ruby.AnyNode[];
  if (node.type === "do_block") {
    const [blockStatements, ...rescueElseEnsure] = node.bodystmt.body;

    // You can’t use the to_proc shortcut if you’re rescuing
    if (rescueElseEnsure.some(Boolean)) {
      return null;
    }

    statements = blockStatements.body;
  } else {
    statements = node.stmts.body;
  }

  // Ensure the block contains only one statement
  if (statements.length !== 1) {
    return null;
  }

  // Ensure that statement is a call and that it has no comments attached
  const [call] = statements;
  if (call.type !== "call" || call.comments) {
    return null;
  }

  // Ensure the call is a method of the block argument
  if (
    call.receiver.type !== "var_ref" ||
    call.receiver.value.body !== reqParams[0].body ||
    !isPeriod(call.operator) ||
    call.message === "call" ||
    call.message.type !== "@ident"
  ) {
    return null;
  }

  // Ensure that we're not inside of a hash that is being passed to a key that
  // corresponds to `:if` or `:unless` to avoid problems with callbacks with
  // Rails. For more context, see:
  // https://github.com/prettier/plugin-ruby/issues/449
  let assocNode = null;

  if (path.getValue().type === "method_add_block") {
    assocNode = path.getParentNode();
  } else {
    assocNode = path.getParentNode(2);
  }

  if (assocNode && assocNode.type === "assoc_new") {
    const key = assocNode.key;

    if (key.type === "@label" && ["if:", "unless:"].includes(key.body)) {
      return null;
    }

    if (
      key.type === "symbol_literal" &&
      ["if", "unless"].includes(key.body[0].body)
    ) {
      return null;
    }
  }

  return `&:${call.message.body}`;
}

export default toProc;
