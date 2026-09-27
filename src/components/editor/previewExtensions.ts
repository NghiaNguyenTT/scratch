import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { lowlight } from "./lowlight";
import { CodeBlockView } from "./CodeBlockView";
import { Frontmatter } from "./Frontmatter";
import { Wikilink } from "./Wikilink";
import { ScratchBlockMath, katexMacros } from "./MathExtensions";

// Read-only extension set for note previews (hover popups). Mirrors the main
// editor's rendering config minus interactive-only extensions (slash commands,
// suggestions, search highlight, input rules) so previews render identically.
export function buildPreviewExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
      },
    }).configure({
      lowlight,
      defaultLanguage: null,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "underline cursor-pointer" },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: {
        resizable: false,
        HTMLAttributes: { class: "not-prose" },
      },
    }),
    Frontmatter,
    Markdown.configure({}),
    Wikilink,
    ScratchBlockMath.configure({
      katexOptions: {
        throwOnError: false,
        displayMode: true,
        macros: katexMacros,
      },
    }),
  ];
}
