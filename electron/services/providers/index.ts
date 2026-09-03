import { ProviderRegistry } from '../provider-registry'
import { SerpApiMapsProvider } from './serpapi-maps-provider'
import { SerpApiOrganicProvider } from './serpapi-organic-provider'
import { AnySearchProvider } from './anysearch-provider'
import { LinkedinSearchProvider } from './linkedin-search-provider'
import { CustomsShipmentProvider } from './customs-shipment-provider'
import { TradeShowProvider } from './trade-show-provider'
import { YellowPagesProvider } from './yellow-pages-provider'
import { FacebookSearchProvider } from './facebook-search-provider'

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()

  registry.register(new SerpApiMapsProvider())
  registry.register(new SerpApiOrganicProvider())
  registry.register(new AnySearchProvider())
  registry.register(new LinkedinSearchProvider())
  registry.register(new CustomsShipmentProvider())
  registry.register(new TradeShowProvider())
  registry.register(new YellowPagesProvider())
  registry.register(new FacebookSearchProvider())

  return registry
}

export { ProviderRegistry } from '../provider-registry'
export type {
  ProviderQuery,
  ProviderConfig,
  SearchProvider,
  ProviderExecuteResult,
  ProviderResult,
} from '../provider-registry'
