import ReactMarkdown from 'react-markdown'

/**
 * Shows an article written in markdown (titles, bold, lists, links, code).
 * Safe by design: raw HTML typed by an author is shown as plain text, never run,
 * links with a dangerous address are dropped, and images are not allowed.
 */
export function ArticleBody({ text }: { text: string }) {
  return (
    <ReactMarkdown
      disallowedElements={['img']}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
