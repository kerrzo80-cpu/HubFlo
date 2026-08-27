"use client";

import {
  EXTERIOR_AREA_PRESETS,
  INTERIOR_ROOM_PRESETS,
  ROOM_AREA_CUSTOM,
  WORKS_AREA_CUSTOM,
  WORKS_AREA_PRESETS,
  prefersExteriorRooms,
  roomAreaSelectValue,
  worksAreaSelectValue,
} from "@/lib/works-area-presets";

type WorksAreaNameFieldsProps = {
  name: string;
  onNameChange: (value: string) => void;
  description?: string;
  onDescriptionChange?: (value: string) => void;
  showDescription?: boolean;
};

/** Interior Works / Exterior Work picker + editable display name. */
export function WorksAreaNameFields({
  name,
  onNameChange,
  description = "",
  onDescriptionChange,
  showDescription = true,
}: WorksAreaNameFieldsProps) {
  const selectValue = worksAreaSelectValue(name);

  return (
    <>
      <label>
        Works area
        <select
          aria-label="Works area type"
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === WORKS_AREA_CUSTOM) {
              if ((WORKS_AREA_PRESETS as readonly string[]).includes(name.trim())) {
                onNameChange("");
              }
              return;
            }
            onNameChange(next);
          }}
        >
          {WORKS_AREA_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
          <option value={WORKS_AREA_CUSTOM}>Custom name…</option>
        </select>
      </label>
      <label>
        Name <span>(edit if needed)</span>
        <input
          aria-label="Works area name"
          placeholder="Interior Works"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      {showDescription && onDescriptionChange ? (
        <label>
          Description <span>(Optional)</span>
          <input
            aria-label="Works area description"
            placeholder="Enter a description..."
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

type RoomAreaNameFieldsProps = {
  name: string;
  onNameChange: (value: string) => void;
  /** Parent works-area name — biases the empty default toward interior vs exterior lists. */
  worksAreaHint?: string;
  optional?: boolean;
};

/** Room / exterior area picker for cost centre display names. */
export function RoomAreaNameFields({
  name,
  onNameChange,
  worksAreaHint = "",
  optional = true,
}: RoomAreaNameFieldsProps) {
  const selectValue = roomAreaSelectValue(name);
  const exteriorFirst = prefersExteriorRooms(worksAreaHint);

  const interiorOptions = INTERIOR_ROOM_PRESETS.map((preset) => (
    <option key={preset} value={preset}>
      {preset}
    </option>
  ));
  const exteriorOptions = EXTERIOR_AREA_PRESETS.map((preset) => (
    <option key={preset} value={preset}>
      {preset}
    </option>
  ));

  return (
    <>
      <label>
        Room / area
        <select
          aria-label="Room or area for cost centre"
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === ROOM_AREA_CUSTOM) {
              onNameChange("");
              return;
            }
            onNameChange(next);
          }}
        >
          <option value={ROOM_AREA_CUSTOM}>{optional ? "Choose a room / area…" : "Custom name…"}</option>
          {exteriorFirst ? (
            <>
              <optgroup label="Exterior">{exteriorOptions}</optgroup>
              <optgroup label="Interior rooms">{interiorOptions}</optgroup>
            </>
          ) : (
            <>
              <optgroup label="Interior rooms">{interiorOptions}</optgroup>
              <optgroup label="Exterior">{exteriorOptions}</optgroup>
            </>
          )}
        </select>
      </label>
      <label>
        Cost centre name {optional ? <span>(edit if needed)</span> : null}
        <input
          aria-label="Cost centre name"
          placeholder={exteriorFirst ? "e.g. Rainwater goods" : "e.g. Kitchen"}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
    </>
  );
}
