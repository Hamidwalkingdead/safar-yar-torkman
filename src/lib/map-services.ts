import { neshanReverse, neshanRoute, neshanSearch } from "@/lib/neshan.functions";
import type { RouteResult } from "./geo";
import type { LatLng, PlaceSearchProvider, RoutingProvider } from "./map-provider";

/** App-facing facade: UI components depend on provider contracts, not Neshan RPC names. */
class NeshanRoutingAdapter implements RoutingProvider {
  async getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    return neshanRoute({ data: { origin, destination } });
  }
}

class NeshanPlaceSearchAdapter implements PlaceSearchProvider {
  async search(query: string, _near?: LatLng) {
    const place = await neshanSearch({ data: { q: query } });
    return place ? { name: place.name, coordinate: { lat: place.lat, lng: place.lng } } : null;
  }

  reverseGeocode(point: LatLng) {
    return neshanReverse({ data: point });
  }
}

export const routingProvider: RoutingProvider = new NeshanRoutingAdapter();
export const placeSearchProvider: PlaceSearchProvider = new NeshanPlaceSearchAdapter();
