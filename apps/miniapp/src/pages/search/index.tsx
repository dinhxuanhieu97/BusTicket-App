import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { copy } from "@/constants/copy";
import { useOpenRoutes } from "@/services/trip/trip.queries";
import { formatVnDate, vnDate } from "@/utils/time";
import { DiscoverRoutes } from "@/components/home/discover-routes";
import { Stepper } from "@/components/booking/stepper";
import { BannerSlider } from "@/components/home/banner-slider";
import { RouteSelect } from "@/components/booking/route-select";
import { useTripSearch } from "@/stores/trip-search.store";
import { tripResultsUrl, validRoundTrip } from "@/utils/trip-search";
import { SearchIcon } from "@/components/common/vectors";

export default function SearchPage() {
  const navigate = useNavigate();
  const { search, submit: setSearch } = useTripSearch();
  const [date, setDate] = useState(search.date);
  const [origin, setOrigin] = useState(search.origin);
  const [destination, setDestination] = useState(search.destination);
  const [roundTrip, setRoundTrip] = useState(search.roundTrip);
  const [returnDate, setReturnDate] = useState(search.returnDate);
  const [adults, setAdults] = useState(search.adults ?? 1);
  const [infants, setInfants] = useState(search.infants ?? 0);
  const [showPassengers, setShowPassengers] = useState(false);
  const initialized = useRef(!!search.origin);
  const [formError, setFormError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const catalog = useOpenRoutes();
  const origins = useMemo(
    () => [...new Set(catalog.data?.map((route) => route.origin))],
    [catalog.data],
  );
  const destinations = useMemo(
    () => [
      ...new Set(
        catalog.data
          ?.filter((route) => !origin || route.origin === origin)
          .map((route) => route.destination),
      ),
    ],
    [catalog.data, origin],
  );
  useEffect(() => {
    const first = catalog.data?.[0];
    if (initialized.current || !first) return;
    initialized.current = true;
    setOrigin(first.origin);
    setDestination(first.destination);
  }, [catalog.data]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = {
      date,
      origin,
      destination,
      roundTrip,
      returnDate,
      adults,
      infants,
    };
    if (!validRoundTrip(next)) {
      setFormError(true);
      return;
    }
    setFormError(false);
    setSearch(next);
    navigate(tripResultsUrl(next));
  };
  return (
    <div className="pn-home">
      <BannerSlider
        onSearch={() => {
          formRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          formRef.current
            ?.querySelector<HTMLButtonElement>("button")
            ?.focus({ preventScroll: true });
        }}
      />
      <div className="pn-page pn-overlap">
        <form
          ref={formRef}
          className="pn-card pn-flight-form"
          onSubmit={submit}
        >
          <fieldset className="pn-journey-tabs">
            <legend className="sr-only">{copy.search.journeyType}</legend>
            {[false, true].map((value) => (
              <label key={String(value)}>
                <input
                  type="radio"
                  name="journey-type"
                  checked={roundTrip === value}
                  onChange={() => {
                    setRoundTrip(value);
                    setFormError(false);
                  }}
                />
                <span>
                  {value ? copy.search.roundTrip : copy.search.oneWay}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="pn-search-route">
            <RouteSelect
              label={copy.search.origin}
              value={origin}
              options={origins}
              placeholder={copy.search.allOrigins}
              onChange={(value) => {
                setOrigin(value);
                setDestination("");
              }}
            />
            <button
              type="button"
              className="pn-swap"
              aria-label="Đổi điểm đi và điểm đến"
              disabled={!origin || !destination}
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4" />
              </svg>
            </button>
            <RouteSelect
              label={copy.search.destination}
              value={destination}
              options={destinations}
              placeholder={copy.search.allDestinations}
              onChange={setDestination}
              alignEnd
            />
          </div>
          <div className={`pn-search-date ${roundTrip ? "pn-date-pair" : ""}`}>
            <TravelDate
              label={copy.search.date}
              value={date}
              min={vnDate(new Date())}
              onChange={(value) => {
                setDate(value);
                if (returnDate && returnDate < value) setReturnDate("");
              }}
            />
            {roundTrip && (
              <TravelDate
                label={copy.search.returnDate}
                value={returnDate}
                min={date || vnDate(new Date())}
                onChange={setReturnDate}
              />
            )}
          </div>
          <div className="pn-passenger-field">
            <button
              type="button"
              className="pn-passenger-toggle"
              aria-expanded={showPassengers}
              onClick={() => setShowPassengers(!showPassengers)}
            >
              <span>
                <small>Hành khách</small>
                <strong className="pn-people-value">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <circle cx="10" cy="7" r="3.5" />
                    <path d="M3 21v-2a7 7 0 0 1 14 0v2m-1-17a3.5 3.5 0 0 1 0 7m2 3a6 6 0 0 1 4 6" />
                  </svg>
                  {adults} người lớn
                  {infants > 0 && ` · ${infants} trẻ dưới 2 tuổi`}
                </strong>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
            {showPassengers && (
              <div className="pn-passenger-counts">
                <div className="pn-row">
                  <span>Người lớn</span>
                  <Stepper
                    label="người lớn"
                    value={adults}
                    min={1}
                    max={40}
                    onChange={setAdults}
                  />
                </div>
                <div className="pn-row">
                  <span>Trẻ dưới 2 tuổi</span>
                  <Stepper
                    label="trẻ dưới 2 tuổi"
                    value={infants}
                    min={0}
                    max={40}
                    onChange={setInfants}
                  />
                </div>
              </div>
            )}
          </div>
          {roundTrip && (
            <p className="pn-meta mb-4">{copy.search.roundTripHint}</p>
          )}
          {formError && (
            <p className="pn-error" role="alert">
              {copy.search.roundTripRequired}
            </p>
          )}
          <button
            className="pn-button pn-button-primary"
            type="submit"
            disabled={!date}
          >
            <SearchIcon className="size-5" aria-hidden="true" />
            {copy.search.submit}
          </button>
        </form>
        <DiscoverRoutes
          onChoose={(route) => {
            const routeDate = vnDate(new Date(route.departAt));
            const next = {
              origin: route.origin,
              destination: route.destination,
              date: routeDate,
              roundTrip: false,
              returnDate: "",
              adults,
              infants,
            };
            setSearch(next);
            navigate(tripResultsUrl(next));
          }}
        />
      </div>
    </div>
  );
}

function TravelDate({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  onChange: (date: string) => void;
}) {
  return (
    <label className="pn-field">
      <span>{label}</span>
      <div className="pn-date-display">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M7 3v5m10-5v5M3 11h18" />
        </svg>
        <span aria-hidden="true">
          {value ? formatVnDate(`${value}T00:00:00+07:00`) : "Chọn ngày về"}
        </span>
        <input
          type="date"
          required
          aria-label={label}
          min={min}
          value={value}
          onClick={(event) => event.currentTarget.showPicker?.()}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}
