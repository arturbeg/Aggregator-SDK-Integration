import type {
  GetLiquidationHistoryForOwnerAddressResult,
  GetMarketsResult,
  GetRageTradeDailyVolumeForPeriodResult,
  GetRageTradeLeaderboardForEpochAndTierResult,
  GetRageTradeLeaderboardForWalletAddressResult,
  GetRageTradeRewardsPerEpochAndTierParams,
  GetRageTradeRewardsPerEpochAndTierResult,
  PositionHistoryEntity
} from '@reyaxyz/api-sdk'
import { ApiClient } from '@reyaxyz/api-sdk'
import type { GetUserTradingLeaderboardDataResult } from '@reyaxyz/common'
import { CommunityClient } from '@reyaxyz/community-sdk'

import { cacheFetch, REYA_CACHE_PREFIX } from '../../common/cache'
import type { ApiOpts } from '../../interfaces'
import { reyaUpdateTokensMap } from './config'

export async function reyaCacheGetAllMarkets(staleTime: number, cacheTime: number, opts?: ApiOpts) {
  const allMarkets: GetMarketsResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'allmarkets'],
    fn: () => ApiClient.markets.getMarkets(),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  reyaUpdateTokensMap(allMarkets)
  return allMarkets
}

export async function reyaCacheGetXpInfo(walletAddress: string, staleTime: number, cacheTime: number, opts?: ApiOpts) {
  const lgeStatus: GetUserTradingLeaderboardDataResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'xp' + '-' + walletAddress],
    fn: () =>
      CommunityClient.lge.getUserTradingLeaderboardData({
        address: walletAddress
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  return lgeStatus
}

export async function reyaCacheGetCompetitionRewards(staleTime: number, cacheTime: number, opts?: ApiOpts) {
  const result: GetRageTradeRewardsPerEpochAndTierResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'competition_rewards'],
    fn: () => ApiClient.rageTrade.getRewardsPerEpochAndTier(),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  return result
}

export async function reyaCacheGetCompetitionLeaderBoard(
  params: GetRageTradeRewardsPerEpochAndTierParams,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  const result: GetRageTradeLeaderboardForEpochAndTierResult = await cacheFetch({
    key: [
      REYA_CACHE_PREFIX,
      'competition_leaderboard' + '-' + params.epochId + '-' + params.tierId + '-' + params.skip + '-' + params.limit
    ],
    fn: () => ApiClient.rageTrade.getLeaderboardForEpochAndTier(params),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  return result
}

export async function reyaCacheGetCompetitionDetailsForWalletAddress(
  walletAddress: string,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  const result: GetRageTradeLeaderboardForWalletAddressResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'competition_details_for_wallet_address' + walletAddress],
    fn: () =>
      ApiClient.rageTrade.getLeaderboardDetailsForWalletAddress({
        walletAddress: walletAddress
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  return result
}

export async function reyaCacheGetDailyTradingVolume(
  timestampFromMs: number,
  timestampToMs: number,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  const result: GetRageTradeDailyVolumeForPeriodResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'dailytradingvolume' + timestampFromMs + '-' + timestampToMs],
    fn: () =>
      ApiClient.rageTrade.getDailyVolumeForPeriod({
        timestampFrom: timestampFromMs,
        timestampTo: timestampToMs
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  return result
}

export async function reyaCacheGetMaxExposure(staleTime: number, cacheTime: number, opts?: ApiOpts) {
  const allMarkets: GetMarketsResult = await cacheFetch({
    key: [REYA_CACHE_PREFIX, 'marketexposure'],
    fn: () => ApiClient.markets.getMarkets(),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })

  const maxExposures = []
  for (const market of allMarkets) {
    const exposureLong = await cacheFetch({
      key: [REYA_CACHE_PREFIX, `marketexposure_long_${market.id}`],
      fn: () =>
        ApiClient.account.getMaxOrderSizeAvailable({
          marketId: market.id,
          marginAccountId: 2,
          direction: 'long'
        }),
      staleTime: staleTime,
      cacheTime: cacheTime,
      opts
    })
    const exposureshort = await cacheFetch({
      key: [REYA_CACHE_PREFIX, `marketexposure_short_${market.id}`],
      fn: () =>
        ApiClient.account.getMaxOrderSizeAvailable({
          marketId: market.id,
          marginAccountId: 2,
          direction: 'long'
        }),
      staleTime: staleTime,
      cacheTime: cacheTime,
      opts
    })
    maxExposures.push({
      ...exposureLong,
      type: 'long',
      marketId: market.id
    })
    maxExposures.push({
      ...exposureshort,
      type: 'short',
      marketId: market.id
    })
  }

  return maxExposures
}

export async function reyaCacheGetMarginAccount(
  marginAccountId: number,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  return cacheFetch({
    key: [REYA_CACHE_PREFIX, 'account' + '-' + marginAccountId],
    fn: () =>
      ApiClient.account.getMarginAccount({
        address: '0x0000000000000000000000000000000000000000',
        marginAccountId: marginAccountId
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })
}

export async function reyaCacheGetWithdrawableBalance(
  marginAccountId: number,
  tokenAddress: string,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  return cacheFetch({
    key: [REYA_CACHE_PREFIX, 'withdrawbalance' + '-' + marginAccountId + '-' + tokenAddress],
    fn: () =>
      ApiClient.account.getMaxWithdrawBalanceForAccount({
        tokenAddress: tokenAddress,
        marginAccountId: marginAccountId
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })
}

export async function reyaCacheGetPendingOrders(
  walletAddress: string,
  marginAccountId: number,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
) {
  return cacheFetch({
    key: [REYA_CACHE_PREFIX, 'pending_orders' + '-' + marginAccountId],
    fn: () =>
      ApiClient.conditionalOrders.getConditionalOrdersHistoryForMarginAccount({
        address: walletAddress,
        marginAccountId: marginAccountId,
        limit: 100
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })
}

export async function reyaCacheGetLiquidationHistory(
  walletAddress: string,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
): Promise<GetLiquidationHistoryForOwnerAddressResult> {
  const address: Lowercase<string> = walletAddress.toLowerCase() as Lowercase<string>
  return cacheFetch({
    key: [REYA_CACHE_PREFIX, 'liquidation' + '-' + walletAddress],
    fn: () =>
      ApiClient.account.getLiquidationHistoryForOwnerAddress({
        address: address,
        timestampFromMS: 1 // from start
      }),
    staleTime: staleTime,
    cacheTime: cacheTime,
    opts
  })
}

export async function reyaCacheGetTradeHistory(
  walletAddress: string,
  marginAccountId: number,
  staleTime: number,
  cacheTime: number,
  opts?: ApiOpts
): Promise<PositionHistoryEntity[]> {
  const address: Lowercase<string> = walletAddress.toLowerCase() as Lowercase<string>
  const limitStep = 200
  let page = 1
  let tradeHistory: PositionHistoryEntity[] = []
  let totalCount = 0
  do {
    const tradeHistoryPart = await cacheFetch({
      key: [REYA_CACHE_PREFIX, 'tradesHistory' + '-' + marginAccountId + '-' + page],
      fn: () =>
        ApiClient.account.getPositionsHistoryForMarginAccountPaginated({
          address: address,
          marginAccountId: marginAccountId,
          page: 1,
          perPage: limitStep,
          type: 'order'
        }),
      staleTime: staleTime,
      cacheTime: cacheTime,
      opts
    })

    if (tradeHistoryPart.data && tradeHistoryPart.data.length === limitStep) {
      tradeHistory = tradeHistory.concat(tradeHistoryPart.data)
      page += 1
      totalCount += limitStep
    } else {
      tradeHistory = tradeHistory.concat(tradeHistoryPart.data || [])
      totalCount += tradeHistoryPart.data?.length || 0
      break
    }
    // eslint-disable-next-line no-constant-condition
  } while (true)

  return tradeHistory
}
