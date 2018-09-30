// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("../../addon/mode/simple"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "../../addon/mode/simple"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  // Collect all conllu directives
  var instructions = ["newdoc"],
      instructionRegex = "(" + instructions.join('|') + ")",
      instructionOnlyLine = new RegExp(instructionRegex + "\\s*$", "i"),
      instructionWithArguments = new RegExp(instructionRegex + "(\\s+)", "i");

  CodeMirror.defineSimpleMode("conllu", {
    start: [
      // Comment line: This is a line starting with a comment
      {
        regex: /#.*$/,
        token: "comment"
      },
      {
        regex: /^[0-9]+\t/,
        token: "def"
      },
      {
        regex: /(?<=(^[^\t\n]+\t){6})[0-9]+/,
        token: "def"
      },
      // Highlight an instruction followed by arguments
      {
        regex: instructionWithArguments,
        token: ["variable-2", null],
        next: "arguments"
      },
      {
        regex: /./,
        token: null
      }
    ],
    arguments: [
      {
        // Line comment without instruction arguments is an error
        regex: /#.*$/,
        token: "error",
        next: "start"
      },
      {
        regex: /[^#]+\\$/,
        token: null
      },
      {
        // Match everything except for the inline comment
        regex: /[^#]+/,
        token: null,
        next: "start"
      },
      {
        regex: /$/,
        token: null,
        next: "start"
      },
      // Fail safe return to start
      {
        token: null,
        next: "start"
      }
    ],
      meta: {
          lineComment: "#"
      }
  });

  CodeMirror.defineMIME("text/x-conllu", "conllu");
});
