import { useState } from "react";

import type {
  Comparison,
  SearchFilters,
  SearchQuery,
  SearchResult,
} from "./fakeNetwork";
import { formatCount, formatLength, speedClass } from "./fakeNetwork";
import type { LineSpeed } from "./napsterCatalog";
import { LINE_SPEEDS } from "./napsterCatalog";
import type { NapsterSession, NapsterState } from "./napsterSession";
import type { Column } from "./NapsterTable";
import { NapsterTable } from "./NapsterTable";

/** The Search tab's fields as typed; kept by the window so switching tabs does not lose them. */
export type SearchForm = {
  artist: string;
  title: string;
  maxResults: string;
  bitrate: FilterField;
  frequency: FilterField;
  ping: FilterField;
  lineSpeed: FilterField;
};

export type FilterField = { comparison: "" | Comparison; value: string };

const NO_FILTER: FilterField = { comparison: "", value: "" };

export const EMPTY_SEARCH_FORM: SearchForm = {
  artist: "",
  title: "",
  maxResults: "100",
  bitrate: NO_FILTER,
  frequency: NO_FILTER,
  ping: NO_FILTER,
  lineSpeed: NO_FILTER,
};

const COMPARISONS: readonly Comparison[] = ["at least", "equal to", "at best"];

const FILTER_VALUES: Record<
  "bitrate" | "frequency" | "ping" | "lineSpeed",
  readonly { value: string; label: string }[]
> = {
  bitrate: [64, 96, 112, 128, 160, 192, 256, 320].map((rate) => ({
    value: String(rate),
    label: `${rate} KB/S`,
  })),
  frequency: [22050, 44100, 48000].map((hz) => ({
    value: String(hz),
    label: `${hz} HZ`,
  })),
  ping: [50, 100, 200, 300, 500, 1000].map((ms) => ({
    value: String(ms),
    label: `${ms} MS`,
  })),
  lineSpeed: LINE_SPEEDS.filter((speed) => speed !== "Unknown").map(
    (speed) => ({ value: speed, label: speed }),
  ),
};

function isLineSpeed(value: string): value is LineSpeed {
  return (LINE_SPEEDS as readonly string[]).includes(value);
}

/** The typed form as a network query; a filter missing either half is ignored, as the client did. */
export function queryFromForm(form: SearchForm): SearchQuery {
  const numeric = (field: FilterField) =>
    field.comparison === "" || field.value === ""
      ? undefined
      : { comparison: field.comparison, value: Number(field.value) };
  const speed = form.lineSpeed;
  const filters: SearchFilters = {
    bitrate: numeric(form.bitrate),
    frequency: numeric(form.frequency),
    ping: numeric(form.ping),
    lineSpeed:
      speed.comparison !== "" && isLineSpeed(speed.value)
        ? { comparison: speed.comparison, value: speed.value }
        : undefined,
  };
  const max = Number.parseInt(form.maxResults, 10);
  return {
    artist: form.artist,
    title: form.title,
    maxResults: Number.isFinite(max) && max > 0 ? Math.min(max, 1000) : 100,
    filters,
  };
}

/** The traffic light in front of every result: green fast, yellow modem, red slow. */
export function SpeedDot({ speed }: { speed: LineSpeed }) {
  return (
    <span
      className={`napster-dot ${speedClass(speed)}`}
      aria-label={`${speed} line`}
      role="img"
    />
  );
}

const RESULT_COLUMNS: readonly Column<SearchResult>[] = [
  {
    key: "filename",
    label: "Filename",
    width: 236,
    render: (row) => row.filename,
    sortValue: (row) => row.filename.toLowerCase(),
  },
  {
    key: "filesize",
    label: "Filesize",
    width: 74,
    align: "right",
    render: (row) => formatCount(row.filesize),
    sortValue: (row) => row.filesize,
  },
  {
    key: "bitrate",
    label: "Bitrate",
    width: 46,
    align: "center",
    render: (row) => row.bitrate,
    sortValue: (row) => row.bitrate,
  },
  {
    key: "freq",
    label: "Freq",
    width: 46,
    align: "center",
    render: (row) => row.frequency,
    sortValue: (row) => row.frequency,
  },
  {
    key: "length",
    label: "Length",
    width: 44,
    align: "center",
    render: (row) => formatLength(row.length),
    sortValue: (row) => row.length,
  },
  {
    key: "user",
    label: "User",
    width: 92,
    render: (row) => row.user,
    sortValue: (row) => row.user.toLowerCase(),
  },
  {
    key: "speed",
    label: "Line Speed",
    width: 66,
    align: "center",
    render: (row) => row.lineSpeed,
    sortValue: (row) => LINE_SPEEDS.indexOf(row.lineSpeed),
  },
  {
    key: "ping",
    label: "Ping",
    width: 40,
    align: "center",
    render: (row) => (row.ping === undefined ? "N/A" : row.ping),
    sortValue: (row) => row.ping ?? 9999,
  },
];

export { RESULT_COLUMNS };

function FilterRow({
  label,
  name,
  field,
  onChange,
}: {
  label: string;
  name: keyof typeof FILTER_VALUES;
  field: FilterField;
  onChange: (field: FilterField) => void;
}) {
  return (
    <div className="napster-filter">
      <span>{label}</span>
      <select
        aria-label={`${label} comparison`}
        value={field.comparison}
        onChange={(event) => {
          const value = event.target.value;
          onChange({
            ...field,
            comparison:
              value === ""
                ? ""
                : (COMPARISONS.find((item) => item === value) ?? ""),
          });
        }}
      >
        <option value="" />
        {COMPARISONS.map((comparison) => (
          <option key={comparison} value={comparison}>
            {comparison.toUpperCase()}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} value`}
        value={field.value}
        onChange={(event) => onChange({ ...field, value: event.target.value })}
      >
        <option value="" />
        {FILTER_VALUES[name].map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SearchTab({
  state,
  session,
  form,
  onFormChange,
}: {
  state: NapsterState;
  session: NapsterSession;
  form: SearchForm;
  onFormChange: (form: SearchForm) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const { search } = state;
  const online = state.connection === "online";
  const chosen = search.results.filter((row) => selected.includes(row.id));
  const field =
    (key: "bitrate" | "frequency" | "ping" | "lineSpeed") =>
    (value: FilterField) =>
      onFormChange({ ...form, [key]: value });

  const summary =
    search.status === "searching"
      ? "Searching..."
      : search.status === "done"
        ? `Returned ${search.results.length} results.`
        : online
          ? "Ready."
          : "Not connected.";

  return (
    <div className="napster-pane napster-search">
      <form
        className="napster-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected([]);
          session.search(queryFromForm(form));
        }}
      >
        <fieldset className="napster-group">
          <legend>Search Fields</legend>
          <label className="napster-field">
            <span>Artist:</span>
            <input
              type="text"
              value={form.artist}
              onChange={(event) =>
                onFormChange({ ...form, artist: event.target.value })
              }
            />
          </label>
          <label className="napster-field">
            <span>Song Title:</span>
            <input
              type="text"
              value={form.title}
              onChange={(event) =>
                onFormChange({ ...form, title: event.target.value })
              }
            />
          </label>
          <label className="napster-field">
            <span>Max Results:</span>
            <input
              type="text"
              value={form.maxResults}
              inputMode="numeric"
              onChange={(event) =>
                onFormChange({ ...form, maxResults: event.target.value })
              }
            />
          </label>
          <div className="napster-buttons">
            <button
              type="button"
              onClick={() => {
                onFormChange(EMPTY_SEARCH_FORM);
                setSelected([]);
                session.clearResults();
              }}
            >
              Clear Fields
            </button>
            <button
              type="submit"
              disabled={!online || search.status === "searching"}
            >
              Find It!
            </button>
          </div>
        </fieldset>
        <fieldset className="napster-group">
          <legend>Advanced Fields (OPTIONAL)</legend>
          <FilterRow
            label="Bitrate must be:"
            name="bitrate"
            field={form.bitrate}
            onChange={field("bitrate")}
          />
          <FilterRow
            label="Frequency must be:"
            name="frequency"
            field={form.frequency}
            onChange={field("frequency")}
          />
          <FilterRow
            label="Ping Time must be:"
            name="ping"
            field={form.ping}
            onChange={field("ping")}
          />
          <FilterRow
            label="Line Speed must be:"
            name="lineSpeed"
            field={form.lineSpeed}
            onChange={field("lineSpeed")}
          />
        </fieldset>
      </form>
      <NapsterTable
        label="Search results"
        columns={RESULT_COLUMNS}
        rows={search.results}
        rowKey={(row) => row.id}
        selected={selected}
        onSelect={setSelected}
        onOpen={(row) => session.download([row])}
        marker={(row) => <SpeedDot speed={row.lineSpeed} />}
        empty={
          search.status === "done" && search.results.length === 0
            ? "No songs matched your search."
            : undefined
        }
      />
      <div className="napster-bottom">
        <button
          type="button"
          disabled={chosen.length === 0 || !online}
          onClick={() => {
            session.download(chosen);
            setSelected([]);
          }}
        >
          Get Selected Song(s)
        </button>
        <div className="napster-blackbox" role="status">
          {summary}
        </div>
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() =>
            chosen.forEach((row) => session.addToHotList(row.user))
          }
        >
          Add Selected User to Hot List
        </button>
      </div>
    </div>
  );
}
