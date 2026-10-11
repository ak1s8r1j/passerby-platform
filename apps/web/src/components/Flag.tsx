import "flag-icons/css/flag-icons.min.css";

/**
 * A country's flag. The images ship with the app (nothing is fetched from another site) and each one is
 * only downloaded when it is first shown. It is decoration: the country's name is always written beside it.
 */
export function Flag({ code, round = false }: { code: string; round?: boolean }) {
  return (
    <span
      className={`fi fis fi-${code.toLowerCase()} flag${round ? " round" : ""}`}
      aria-hidden="true"
    />
  );
}
