import PerennialSDK, {
  SupportedAsset,
  ChainMarkets,
  AssetMetadata,
  Big6Math,
  MultiInvokerAddresses,
  PositionSide,
  OrderTypes,
  calcTakerLiquidity,
  calcFundingRates,
  calcLiquidationPrice,
  calcLeverage,
  calcEstExecutionPrice,
  calcTradeFee,
  MarketSnapshots,
  calcMaxLeverage,
  interfaceFeeBps,
  chainAssetsWithAddress,
  OpenOrder,
  addressToAsset,
  Markets,
  KeeperOracleAbi
} from '@perennial/sdk'

import { IAdapterV1, ProtocolInfo } from '../../src/interfaces/V1/IAdapterV1'
import {
  ApiOpts,
  MarketInfo,
  DynamicMarketMetadata,
  CreateOrder,
  UpdateOrder,
  CancelOrder,
  PositionInfo,
  ClosePositionData,
  UpdatePositionMarginData,
  PageOptions,
  PaginatedRes,
  OrderInfo,
  HistoricalTradeInfo,
  LiquidationInfo,
  ClaimInfo,
  OpenTradePreviewInfo,
  CloseTradePreviewInfo,
  AmountInfo,
  PreviewInfo,
  Market,
  Protocol,
  OrderType,
  AccountInfo,
  MarketState,
  CollateralData,
  OrderBook,
  MarketMode,
  ProtocolId,
  AvailableToTradeParams,
  DepositWithdrawParams,
  AgentParams,
  AgentState,
  TradeDirection,
  PositionData,
  AccountInfoData
} from '../interfaces/V1/IRouterAdapterBaseV1'
import { rpc } from '../common/provider'
import { getAddress, zeroAddress, Address, parseUnits } from 'viem-v2'
import { arbitrum as arbitrumChain, optimism } from 'viem/chains'
import { arbitrum } from 'viem-v2/chains'
import { Chain } from 'viem'
import { decodeMarketId, encodeMarketId } from '../common/markets'
import { Token, tokens } from '../common/tokens'
import { FixedNumber } from '../common/fixedNumber'
import { ActionParam } from '../interfaces/IActionExecutor'
import { BigNumber } from 'ethers'
import { EMPTY_DESC } from '../common/buttonHeadings'
import {
  CACHE_DAY,
  CACHE_SECOND,
  CACHE_TIME_MULT,
  PERENNIAL_CACHE_PREFIX,
  cacheFetch,
  getStaleTime,
  invalidateCacheByKeyComponents
} from '../common/cache'
import { getPaginatedResponse, toAmountInfo } from '../common/helper'
import { ZERO_FN } from '../common/constants'

const _rpcUrl = rpc[arbitrum.id].connection.url
const graphUrl = 'https://subgraph.satsuma-prod.com/1f212ca11a3d/equilibria/perennial-v2-arbitrum/api'

/// Constants
const pythUrl = process.env.PERENNIAL_PYTH_URL || 'https://hermes.pyth.network'
const PNL_COLLATERAL_TOKEN = {
  symbol: 'PN-USD',
  name: 'Perennial USD',
  decimals: 6,
  address: {
    42161: undefined,
    10: undefined
  }
} as Token

const perennial = new PerennialSDK({
  chainId: arbitrum.id,
  rpcUrl: _rpcUrl,
  graphUrl,
  pythUrl
})

export const assetToRageToken = (asset: SupportedAsset) => {
  return {
    symbol: AssetMetadata[asset].baseCurrency.toUpperCase(),
    name: AssetMetadata[asset].name,
    decimals: AssetMetadata[asset].displayDecimals,
    address: { [arbitrum.id]: zeroAddress, [optimism.id]: zeroAddress } // TODO: ?
  }
}

const getOrderTypeFromOpenOrder = (order: OpenOrder) => {
  if (Number(order.order_delta) > 0) {
    return 'LIMIT'
  }
  // Longs
  if (order.order_side === 1) {
    return order.order_comparison === 1 ? 'TAKE_PROFIT' : 'STOP_LOSS'
  }
  // Shorts
  return order.order_comparison === 1 ? 'STOP_LOSS' : 'TAKE_PROFIT'
}

const formatOpenOrderToOrderInfo = (order: OpenOrder) => {
  return {
    orderType: getOrderTypeFromOpenOrder(order) as OrderType,
    marketId: encodePerennialMarketId(addressToAsset(getAddress(order.market)) as SupportedAsset),
    mode: 'ISOLATED' as MarketMode,
    tif: undefined,
    protocolId: 'PERENNIAL' as ProtocolId,
    collateral: tokens['USDC.e'],
    orderId: order.nonce.toString(),
    direction: order.order_side === 1 ? ('LONG' as TradeDirection) : ('SHORT' as TradeDirection),
    size: toAmountInfo(BigNumber.from(Big6Math.abs(Big6Math.fromFloatString(order.order_delta))), 6, true),
    sizeDelta: toAmountInfo(BigNumber.from(Big6Math.fromFloatString(order.order_delta)), 6, true),
    marginDelta: toAmountInfo(BigNumber.from('0'), 6, false),
    triggerData: {
      triggerPrice: FixedNumber.fromValue(order.order_price, 6),
      triggerAboveThreshold: false, // TODO: Check this
      triggerLimitPrice: undefined
    }
  }
}

const decodePerennialMarketId = (marketId: string) => {
  const { protocolMarketId } = decodeMarketId(marketId)
  return protocolMarketId.toLowerCase()
}

const encodePerennialMarketId = (asset: string) => {
  return encodeMarketId(arbitrum.id.toString(), 'PERENNIAL', asset.toUpperCase())
}

type GetMaxLeverageParams = {
  wallet: string
  marketId: string
  collateral: string
}

export default class PerennialAdapter implements IAdapterV1 {
  protocolId: ProtocolId = 'PERENNIAL'
  private sdk: PerennialSDK = perennial
  private operatorApproved: boolean = false

  constructor(rpcUrl?: string) {
    if (rpcUrl)
      this.sdk = new PerennialSDK({
        chainId: arbitrum.id,
        rpcUrl: rpcUrl,
        graphUrl,
        pythUrl
      })
  }

  async init(wallet: string | undefined, opts?: ApiOpts | undefined): Promise<void> {
    if (wallet) {
      this.operatorApproved = await this._checkMarketFactoryApproval(wallet)
    }

    this._listenAndInvalidateOnMarketUpdates()
  }

  clearCredentials(): void {
    throw new Error('Method not implemented.')
  }

  async setCredentials(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  setup(): Promise<ActionParam[]> {
    return Promise.resolve([])
  }

  supportedChains() {
    return [arbitrumChain]
  }

  authenticateAgent(agentParams: AgentParams[], wallet: string, opts?: ApiOpts): Promise<ActionParam[]> {
    throw new Error('Method not implemented.')
  }

  getIdleMargins(wallet: string): Promise<(CollateralData & { marketId: Market['marketId']; amount: FixedNumber })[]> {
    throw new Error('Method not implemented.')
  }

  claimFunding(wallet: string, opts?: ApiOpts): Promise<ActionParam[]> {
    throw new Error('Method not implemented.')
  }

  async getMaxLeverage({ wallet, collateral, marketId }: GetMaxLeverageParams): Promise<FixedNumber> {
    const account = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account })

    if (!marketSnapshots || !marketSnapshots.user) throw new Error('No market data')

    const protocolMarketId = decodePerennialMarketId(marketId)
    const marketSnapshot = marketSnapshots.market[protocolMarketId as SupportedAsset]

    if (!marketSnapshot) throw new Error('No market snapshot')

    const maxLeverage = calcMaxLeverage({
      margin: marketSnapshot.riskParameter.margin,
      minMargin: marketSnapshot.riskParameter.minMargin,
      collateral: parseUnits(collateral, 6)
    })

    return FixedNumber.fromValue(maxLeverage, 6, 6)
  }

  getClaimHistory(
    wallet: string,
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<PaginatedRes<ClaimInfo>> {
    throw new Error('Method not implemented.')
  }

  async getOpenTradePreview(
    wallet: string,
    orderData: CreateOrder[],
    existingPos: Array<PositionInfo | undefined>,
    opts?: ApiOpts
  ): Promise<OpenTradePreviewInfo[]> {
    const account = getAddress(wallet)
    const tradePreviews: OpenTradePreviewInfo[] = []
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })

    if (!marketSnapshots || !marketSnapshots.user) throw new Error('No market data')

    for (let i = 0; i < orderData.length; i++) {
      const newOrder = orderData[i]
      const protocolMarketId = decodePerennialMarketId(newOrder.marketId)

      const userMarketSnapshot = marketSnapshots.user[protocolMarketId as SupportedAsset]
      const marketSnapshot = marketSnapshots.market[protocolMarketId as SupportedAsset]

      if (!marketSnapshot) throw new Error('No market snapshot')

      const orderDelta = Big6Math.fromFloatString(newOrder.sizeDelta.amount.toString())
      const availableToTrade = await this.getAvailableToTrade(
        wallet,
        { market: newOrder.marketId } as AvailableToTradeParams<this['protocolId']>,
        opts
      )
      const remainingMarginDelta = availableToTrade.amount.sub(newOrder.marginDelta.amount)
      const collateralDelta = Big6Math.fromFloatString(remainingMarginDelta.toString())
      const positionSide = newOrder.direction === 'LONG' ? PositionSide.long : PositionSide.short

      const newPosition = orderDelta + (userMarketSnapshot?.nextMagnitude ?? 0)
      const newCollateral = collateralDelta + (userMarketSnapshot?.local.collateral ?? 0)
      const latestPrice = marketSnapshot?.global?.latestPrice ?? 0n
      const newLeverage = calcLeverage(latestPrice, newPosition, newCollateral)

      const tradeFee = calcTradeFee({
        positionDelta: orderDelta,
        isMaker: false,
        marketSnapshot,
        direction: positionSide
      })

      const estEntryPrice = !Big6Math.isZero(orderDelta)
        ? calcEstExecutionPrice({
            orderDirection: positionSide,
            oraclePrice: latestPrice,
            positionDelta: Big6Math.abs(orderDelta),
            calculatedFee: tradeFee.total,
            positionFee: marketSnapshot?.parameter.positionFee ?? 0n
          })
        : { total: latestPrice, priceImpact: 0n, priceImpactPercentage: 0n }

      const liquidationPrice = calcLiquidationPrice({
        marketSnapshot,
        collateral: newCollateral,
        position: newPosition
      })[positionSide]

      const liquidityData = calcTakerLiquidity(marketSnapshot)
      const availableLiquidity =
        positionSide === PositionSide.long
          ? liquidityData.availableLongLiquidity
          : liquidityData.availableShortLiquidity

      const orderExceedsLiquidity = orderDelta + marketSnapshot.nextPosition[positionSide] > availableLiquidity
      const isSocialized = orderDelta > 0n && marketSnapshot.isSocialized
      const maxLeverage = calcMaxLeverage({
        margin: marketSnapshot.riskParameter.margin,
        minMargin: marketSnapshot.riskParameter.minMargin,
        collateral: newCollateral
      })

      const isError = orderExceedsLiquidity || isSocialized || newLeverage > maxLeverage
      let errMsg = ''
      if (orderExceedsLiquidity) {
        errMsg = 'Order exceeds available liquidity'
      } else if (isSocialized) {
        errMsg = 'Order would socialize the market'
      } else if (newLeverage > maxLeverage) {
        errMsg = 'Order would exceed max leverage'
      }

      const nonImpactTradeFee = Big6Math.mul(marketSnapshot.parameter.positionFee, tradeFee.total)
      const totalNonImpactTradeFee = marketSnapshot.parameter.settlementFee + nonImpactTradeFee

      tradePreviews.push({
        marketId: newOrder.marketId,
        leverage: FixedNumber.fromValue(newLeverage, 6),
        size: toAmountInfo(BigNumber.from(newPosition), 6, true),
        margin: toAmountInfo(BigNumber.from(newCollateral), 6, true),
        avgEntryPrice: FixedNumber.fromValue(estEntryPrice.total, 6),
        liqudationPrice: FixedNumber.fromValue(liquidationPrice, 6),
        fee: FixedNumber.fromValue(totalNonImpactTradeFee, 6),
        collateral: tokens['USDC.e'],
        isError,
        errMsg,
        priceImpact: FixedNumber.fromValue(estEntryPrice.priceImpactPercentage * 100n, 6)
      })
    }
    return tradePreviews
  }

  async getCloseTradePreview(
    wallet: string,
    positionInfo: PositionInfo[],
    closePositionData: ClosePositionData[],
    opts?: ApiOpts
  ): Promise<CloseTradePreviewInfo[]> {
    const account = getAddress(wallet)
    const tradePreviews: CloseTradePreviewInfo[] = []
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })
    if (!marketSnapshots || !marketSnapshots.user) throw new Error('No market data')
    for (let i = 0; i < closePositionData.length; i++) {
      const closeOrder = closePositionData[i]
      const ragePosition = positionInfo[i]
      const protocolMarketId = decodePerennialMarketId(ragePosition.marketId)
      const userMarketSnapshot = marketSnapshots.user[protocolMarketId as SupportedAsset]
      const marketSnapshot = marketSnapshots.market[protocolMarketId as SupportedAsset]
      if (!marketSnapshot) throw new Error('No market snapshot')
      const orderDelta = Big6Math.fromFloatString(closeOrder.closeSize.amount.toString())
      const positionSide = userMarketSnapshot.nextSide as PositionSide.long | PositionSide.short
      const newPosition = userMarketSnapshot.nextMagnitude - orderDelta
      const latestPrice = marketSnapshot.global.latestPrice

      const newLeverage = calcLeverage(latestPrice, newPosition, userMarketSnapshot.local.collateral)
      const tradeFee = calcTradeFee({
        positionDelta: orderDelta,
        isMaker: false,
        marketSnapshot,
        direction: positionSide
      })

      const liquidationPrice = calcLiquidationPrice({
        marketSnapshot,
        collateral: userMarketSnapshot.local.collateral,
        position: newPosition
      })[positionSide]

      const maxLeverage = calcMaxLeverage({
        margin: marketSnapshot.riskParameter.margin,
        minMargin: marketSnapshot.riskParameter.minMargin,
        collateral: userMarketSnapshot.local.collateral
      })

      let errMsg = ''
      if (newLeverage > Big6Math.fromFloatString(maxLeverage.toString())) {
        errMsg = 'New position would exceed max leverage.'
      }

      tradePreviews.push({
        marketId: ragePosition.marketId,
        leverage: FixedNumber.fromValue(newLeverage, 6),
        size: toAmountInfo(BigNumber.from(newPosition), 6, true),
        margin: toAmountInfo(BigNumber.from(userMarketSnapshot.local.collateral), 6, true),
        fee: FixedNumber.fromValue(tradeFee.total, 6),
        collateral: tokens['USDC.e'],
        avgEntryPrice: FixedNumber.fromValue(latestPrice, 6),
        liqudationPrice: FixedNumber.fromValue(liquidationPrice, 6),
        isError: !!errMsg,
        errMsg,
        receiveMargin: toAmountInfo(BigNumber.from(0), 6, true)
      })
    }
    return tradePreviews
  }

  async getUpdateMarginPreview(
    wallet: string,
    isDeposit: boolean[],
    marginDelta: AmountInfo[],
    existingPos: Array<PositionInfo>,
    opts?: ApiOpts
  ): Promise<PreviewInfo[]> {
    const previewsInfo: PreviewInfo[] = []
    const account = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })

    if (!marketSnapshots || !marketSnapshots.user) throw new Error('No market data')

    for (let i = 0; i < existingPos.length; i++) {
      const ragePosition = existingPos[i]
      const protocolMarketId = decodePerennialMarketId(ragePosition.marketId)
      const userMarketSnapshot = marketSnapshots.user[protocolMarketId as SupportedAsset]
      const marketSnapshot = marketSnapshots.market[protocolMarketId as SupportedAsset]

      if (!marketSnapshot) throw new Error('No market snapshot')

      const collateralDelta = Big6Math.fromFloatString(marginDelta[i].amount.toString())
      const latestPrice = marketSnapshot?.global?.latestPrice ?? 0n
      const newCollateral = userMarketSnapshot.local.collateral + collateralDelta
      const newLeverage = calcLeverage(latestPrice, userMarketSnapshot.nextMagnitude, newCollateral)
      const liquidationPrice = calcLiquidationPrice({
        marketSnapshot,
        collateral: newCollateral,
        position: userMarketSnapshot.nextMagnitude
      })[userMarketSnapshot.nextSide as PositionSide.long | PositionSide.short]

      const maxLeverage = calcMaxLeverage({
        margin: marketSnapshot.riskParameter.margin,
        minMargin: marketSnapshot.riskParameter.minMargin,
        collateral: newCollateral
      })

      const isError = newLeverage > maxLeverage
      const errMsg = isError ? 'Margin change would exceed max leverage' : ''

      previewsInfo.push({
        marketId: ragePosition.marketId,
        leverage: FixedNumber.fromValue(newLeverage, 6),
        size: toAmountInfo(BigNumber.from(userMarketSnapshot.nextMagnitude), 6, true),
        margin: toAmountInfo(BigNumber.from(newCollateral), 6, true),
        liqudationPrice: FixedNumber.fromValue(liquidationPrice, 6),
        collateral: tokens['USDC.e'],
        avgEntryPrice: FixedNumber.fromValue(latestPrice, 6),
        fee: FixedNumber.fromValue(0, 6),
        isError,
        errMsg
      })
    }
    return previewsInfo
  }

  getTotalClaimableFunding(wallet: string, opts?: ApiOpts): Promise<FixedNumber> {
    throw new Error('Method not implemented.')
  }

  getTotalAccuredFunding(wallet: string, opts?: ApiOpts): Promise<FixedNumber> {
    throw new Error('Method not implemented.')
  }

  async getAccountInfo(wallet: string, opts?: ApiOpts): Promise<AccountInfo[]> {
    const marketSnapshots = await this._cachedMarketSnapshots({
      address: getAddress(wallet),
      opts
    })
    if (!marketSnapshots?.user) return []

    const accountInfos: AccountInfoData<'PERENNIAL'>[] = await Promise.all(
      Object.values(marketSnapshots.user).map(async (userMarketSnapshot) => {
        if (userMarketSnapshot.side === PositionSide.maker)
          return {
            accountEquity: FixedNumber.fromString('0'),
            unrealizedPnl: FixedNumber.fromString('0'),
            availableToTrade: FixedNumber.fromString('0')
          }

        const pnl = await this._cachedActivePositionPnls({
          asset: userMarketSnapshot.asset,
          marketSnapshots,
          address: getAddress(wallet),
          opts
        })

        return {
          accountEquity: FixedNumber.fromValue(userMarketSnapshot.nextNotional, 6),
          unrealizedPnl: FixedNumber.fromValue(pnl?.realtime ?? 0n, 6),
          availableToTrade: FixedNumber.fromValue(userMarketSnapshot.local.collateral, 6)
        }
      })
    )

    return [
      {
        protocolId: this.protocolId,
        accountInfoData: accountInfos.reduce(
          (acc, curr) => {
            acc.accountEquity = acc.accountEquity.add(curr.accountEquity)
            acc.unrealizedPnl = acc.unrealizedPnl.add(curr.unrealizedPnl)
            acc.availableToTrade = acc.availableToTrade.add(curr.availableToTrade)
            return acc
          },
          {
            accountEquity: FixedNumber.fromString('0'),
            unrealizedPnl: FixedNumber.fromString('0'),
            availableToTrade: FixedNumber.fromString('0')
          } as AccountInfoData<'PERENNIAL'>
        )
      }
    ]
  }

  getMarketState(wallet: string, marketIds: Market['marketId'][], opts?: ApiOpts): Promise<MarketState[]> {
    return Promise.resolve([])
  }

  getAgentState(wallet: string, agentParams: AgentParams[], opts?: ApiOpts): Promise<AgentState[]> {
    throw new Error('Method not implemented.')
  }

  getOrderBooks(
    marketIds: Market['marketId'][],
    precision: (number | undefined)[],
    opts?: ApiOpts
  ): Promise<OrderBook[]> {
    return Promise.resolve([])
  }

  async getLiquidationHistory(
    wallet: string,
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<PaginatedRes<LiquidationInfo>> {
    const account = getAddress(wallet)
    const marketInfo = await this._cachedMarkets(opts)
    const marketIDs = Object.keys(marketInfo)
    const markets: Markets = []

    for (let i = 0; i < marketIDs.length; i++) {
      const protocolMarketId = decodePerennialMarketId(marketIDs[i])
      const asset = protocolMarketId.toLowerCase() as SupportedAsset
      const marketAddress = ChainMarkets[arbitrum.id][asset]
      if (!marketAddress) continue
      markets.push({ asset, marketAddress })
    }

    const tradeHistory = await this.sdk.markets.read.historicalPositions({
      address: account,
      markets,
      pageSize: pageOptions?.limit ?? 100
    })

    const liquidatedPositions = tradeHistory.positions.filter((position) => {
      return position.liquidation
    })

    const liquidations: LiquidationInfo[] = []
    for (const position of liquidatedPositions) {
      const market = ChainMarkets[arbitrum.id][position.asset as SupportedAsset]
      if (!market) continue
      // First 100 for now.
      const liquidatedSubpositionHistory = await this.sdk.markets.read.subPositions({
        address: account,
        market,
        startVersion: position.startVersion,
        endVersion: position.endVersion,
        first: 100,
        skip: 0
      })

      const liquidationTx = liquidatedSubpositionHistory.changes[0]

      liquidations.push({
        marketId: encodePerennialMarketId(position.asset),
        timestamp: new Date(Number(liquidationTx.blockTimestamp) * 1000).getTime(),
        direction: position.side === PositionSide.long ? 'LONG' : 'SHORT',
        sizeClosed: toAmountInfo(BigNumber.from(position.startSize), 6, true),
        realizedPnl: FixedNumber.fromValue(position.accumulated.pnl, 6),
        liquidationFees: FixedNumber.fromValue(position.liquidationFee, 6),
        remainingCollateral: toAmountInfo(BigNumber.from(liquidationTx.collateral), 6, false),
        liqudationLeverage: FixedNumber.fromString('100'), // TODO: Calculate leverage at time of liquidation
        liquidationPrice: FixedNumber.fromValue(liquidationTx.priceWithImpact, 6),
        txHash: liquidationTx.transactionHash,
        collateral: tokens['USDC.e'],
        id: liquidationTx.transactionHash
      })
    }
    return {
      result: liquidations,
      maxItemsCount: liquidations.length
    }
  }

  async getAvailableToTrade(wallet: string, params: AvailableToTradeParams<this['protocolId']>, opts?: ApiOpts) {
    const zeroAmount = toAmountInfo(BigNumber.from(0), 6, false)

    if (!params) return zeroAmount

    const marketSnapshots = await this._cachedMarketSnapshots({
      address: getAddress(wallet),
      opts
    })
    const asset = decodePerennialMarketId(params.market) as SupportedAsset

    if (!marketSnapshots?.user?.[asset]) return zeroAmount

    return toAmountInfo(BigNumber.from(marketSnapshots.user[asset].local.collateral), 6, false, 6)
  }

  async deposit(params: DepositWithdrawParams[]): Promise<ActionParam[]> {
    console.log('Deposit')

    const txs: ActionParam[] = []
    const supportedChainIds: number[] = this.supportedChains().map((chain) => chain.id)

    for (const param of params) {
      const { protocol, chainId, amount, wallet, token, market } = param
      if (!market) throw new Error('invalid market id')
      const perennialMarketId = decodePerennialMarketId(market)
      const account = getAddress(wallet)
      const marketSnapshots = await this._cachedMarketSnapshots({ address: account })
      const approveOperatorTx = await this._approveMarketFactory(wallet)
      if (approveOperatorTx) {
        txs.push(approveOperatorTx)
      }
      const usdcContract = this.sdk.contracts.getUSDCContract()
      const udscBalance = await usdcContract.read.balanceOf([account])

      const balanceFN = FixedNumber.fromValue(udscBalance, 6)
      if (amount.value > balanceFN.value) throw new Error('Insufficient balance')

      const usdcAllowance = await usdcContract.read.allowance([account, MultiInvokerAddresses[arbitrum.id]])
      if (amount.value > usdcAllowance) {
        const approveTx = await this._approveUSDC({
          account,
          market: perennialMarketId as SupportedAsset,
          amount: amount.value,
          marketSnapshots
        })
        if (approveTx) {
          txs.push(approveTx)
        }
      }
      const productAddress = ChainMarkets[arbitrum.id][perennialMarketId as SupportedAsset]
      if (protocol !== 'PERENNIAL') throw new Error('invalid protocol id')
      if (!supportedChainIds.includes(chainId)) throw new Error('chain id mismatch')
      if (!productAddress) throw new Error('invalid product address')

      const txData = await this.sdk.markets.build.modifyPosition({
        collateralDelta: Big6Math.fromFloatString(amount.toString()),
        marketAddress: productAddress,
        address: account
      })

      if (txData?.data) {
        txs.push({
          tx: {
            to: txData.to,
            data: txData.data,
            value: BigNumber.from(txData.value),
            chainId: arbitrum.id
          },
          desc: EMPTY_DESC,
          chainId: arbitrum.id,
          isUserAction: true,
          isAgentRequired: false,
          heading: 'Perennial Deposit',
          ethRequired: BigNumber.from(0)
        })
      }
    }
    return txs
  }

  async withdraw(params: DepositWithdrawParams[]): Promise<ActionParam[]> {
    const txs: ActionParam[] = []
    const supportedChainIds: number[] = this.supportedChains().map((chain) => chain.id)
    for (const param of params) {
      const { protocol, chainId, amount, token, wallet, market } = param
      if (!market) throw new Error('invalid market id')
      const perennialMarketId = decodePerennialMarketId(market)
      const productAddress = ChainMarkets[arbitrum.id][perennialMarketId as SupportedAsset]
      if (protocol !== 'PERENNIAL') throw new Error('invalid protocol id')
      if (!supportedChainIds.includes(chainId)) throw new Error('chain id mismatch')
      if (!productAddress) throw new Error('invalid product address')

      const withdrawTxData = await this.sdk.markets.build.modifyPosition({
        collateralDelta: Big6Math.fromFloatString((-amount).toString()),
        address: getAddress(wallet),
        marketAddress: productAddress
      })

      if (withdrawTxData?.data) {
        txs.push({
          tx: {
            to: withdrawTxData.to,
            data: withdrawTxData.data,
            value: BigNumber.from(withdrawTxData.value),
            chainId: arbitrum.id
          },
          desc: EMPTY_DESC,
          chainId: arbitrum.id,
          isUserAction: true,
          isAgentRequired: false,
          heading: 'Perennial Withdraw',
          ethRequired: BigNumber.from(0)
        })
      }
    }
    return txs
  }

  _handlePositionChange =
    (orderType: 'increase' | 'decrease') =>
    async (orderData: CreateOrder[], wallet: string, opts?: ApiOpts | undefined): Promise<ActionParam[]> => {
      let txs: ActionParam[] = []
      const account = getAddress(wallet)
      const usdcContract = this.sdk.contracts.getUSDCContract()
      const udscBalance = await usdcContract.read.balanceOf([account])
      const usdcAllowance = await usdcContract.read.allowance([account, MultiInvokerAddresses[arbitrum.id]])
      const balanceFN = FixedNumber.fromValue(udscBalance, 6, 6)
      const approveOperatorTx = await this._approveMarketFactory(wallet)

      if (approveOperatorTx) {
        txs.push(approveOperatorTx)
      }

      const marketOracles = await this.sdk.markets.read.marketOracles()
      const marketSnapshots = await this._cachedMarketSnapshots({
        address: account,
        opts
      })
      for (const order of orderData) {
        const { marketId, sizeDelta, marginDelta, direction, type } = order
        const protocolMarketId = decodePerennialMarketId(marketId)
        const productAddress = ChainMarkets[arbitrum.id][protocolMarketId as SupportedAsset]

        if (!productAddress) throw new Error('Invalid market id')
        if (!marketSnapshots?.user) throw new Error('No user position data')

        const userPositionData = marketSnapshots.user[protocolMarketId as SupportedAsset]
        const marketSnapshot = marketSnapshots.market[protocolMarketId as SupportedAsset]
        const positionAbs =
          orderType === 'increase'
            ? userPositionData.nextMagnitude + sizeDelta.amount.toFormat(6).value
            : userPositionData.nextMagnitude - sizeDelta.amount.toFormat(6).value

        const availableToTrade = await this.getAvailableToTrade(
          wallet,
          { market: marketId } as AvailableToTradeParams<this['protocolId']>,
          opts
        )
        const remainingMarginDelta = availableToTrade.amount.sub(marginDelta.amount)
        // Check margin delta against the user's balance and allowance
        if (!remainingMarginDelta.isNegative() && remainingMarginDelta.gt(balanceFN)) {
          throw new Error('Insufficient balance')
        }
        if (!remainingMarginDelta.isNegative() && remainingMarginDelta.value > usdcAllowance) {
          const approveTxData = await this.sdk.operator.build.approveUSDC({
            suggestedAmount: remainingMarginDelta.value
          })
          if (approveTxData.data) {
            txs.push({
              tx: {
                to: approveTxData.to,
                data: approveTxData.data,
                value: BigNumber.from(approveTxData.value),
                chainId: arbitrum.id
              },
              desc: EMPTY_DESC,
              chainId: arbitrum.id,
              isUserAction: true,
              isAgentRequired: false,
              heading: 'Perennial Approve USDC',
              ethRequired: BigNumber.from(0)
            })
          }
        }
        const positionSide = direction === 'LONG' ? PositionSide.long : PositionSide.short

        let positionChangeTxData
        if (type === 'MARKET') {
          positionChangeTxData = await this.sdk.markets.build.modifyPosition({
            positionSide,
            positionAbs,
            collateralDelta: remainingMarginDelta.toFormat(6).value,
            interfaceFeeRate: interfaceFeeBps,
            settlementFee: marketSnapshot?.parameter.settlementFee ?? 0n,
            address: account,
            marketAddress: productAddress,
            marketSnapshots,
            marketOracles
          })
        } else {
          positionChangeTxData = await this.sdk.markets.build.placeOrder({
            orderType: OrderTypes.limit,
            side: positionSide,
            positionAbs,
            delta: sizeDelta.amount.toFormat(6).value,
            collateralDelta: remainingMarginDelta.toFormat(6).value,
            limitPrice: order.triggerData?.triggerPrice.toFormat(6).value,
            address: account,
            marketAddress: productAddress,
            marketSnapshots,
            marketOracles
          })
        }

        if (!positionChangeTxData?.data) {
          throw new Error('Invalid position change data')
        }

        txs.push({
          tx: {
            to: positionChangeTxData.to,
            data: positionChangeTxData.data,
            value: BigNumber.from(positionChangeTxData.value),
            chainId: arbitrum.id
          },
          desc: EMPTY_DESC,
          chainId: arbitrum.id,
          isUserAction: true,
          isAgentRequired: false,
          heading: orderType === 'increase' ? 'Perennial Increase Position' : 'Perennial Decrease Position',
          ethRequired: BigNumber.from(0)
        })
      }
      return txs
    }

  increasePosition = this._handlePositionChange('increase')
  decreasePosition = this._handlePositionChange('decrease')

  async closePosition(
    positionInfo: PositionInfo[],
    closePositionData: ClosePositionData[],
    wallet: string,
    opts?: ApiOpts
  ): Promise<ActionParam[]> {
    let txs: ActionParam[] = []
    const account = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })

    if (positionInfo.length !== closePositionData.length) throw new Error('position close data mismatch')
    for (let i = 0; i < positionInfo.length; i++) {
      const position = positionInfo[i]
      const closeData = closePositionData[i]
      const positionSize = position.size.amount.toFormat(6).value
      const closeSize = closeData.closeSize.amount.toFormat(6).value
      const positionSide = position.direction === 'LONG' ? PositionSide.long : PositionSide.short

      if (closeSize > positionSize) throw new Error('close size cannot be greater than position size')

      const protocolMarketId = decodePerennialMarketId(position.marketId)
      const productAddress = ChainMarkets[arbitrum.id][protocolMarketId as SupportedAsset]
      if (!productAddress) throw new Error('Invalid market id')
      if (!marketSnapshots?.user) throw new Error('No user position data')

      const userPositionData = marketSnapshots.user[protocolMarketId as SupportedAsset]

      const positionAbs = userPositionData.nextMagnitude - closeSize

      const positionChangeTxData = await this.sdk.markets.build.modifyPosition({
        positionSide,
        positionAbs,
        address: account,
        marketAddress: productAddress
      })

      if (!positionChangeTxData?.data) {
        throw new Error('Invalid position change data')
      }

      txs.push({
        tx: {
          to: positionChangeTxData.to,
          data: positionChangeTxData.data,
          value: BigNumber.from(positionChangeTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Close Position',
        ethRequired: BigNumber.from(0)
      })
    }
    return txs
  }

  async updateOrder(orderData: UpdateOrder[], wallet: string, opts?: ApiOpts): Promise<ActionParam[]> {
    let txs: ActionParam[] = []
    const account = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })
    if (!marketSnapshots) throw new Error('No market data')

    for (const order of orderData) {
      const protocolMarketId = decodePerennialMarketId(order.marketId)
      const marketAsset = protocolMarketId as SupportedAsset
      const marketAddress = ChainMarkets[arbitrum.id][marketAsset]
      if (!marketAddress) throw new Error('Invalid market id')

      const market = { asset: marketAsset, marketAddress }
      const openOrderGraphData = await this.sdk.markets.read.openOrders({
        address: account,
        markets: [market],
        pageParam: 0,
        pageSize: 100
      })

      const orderToUpdate = openOrderGraphData?.openOrders.find((o) => o.nonce === order.orderId)
      if (!orderToUpdate) throw new Error('Order not found')
      // Cancel and replace.
      const cancelOrderTxData = await this.sdk.markets.build.cancelOrder([[marketAddress, BigInt(orderToUpdate.nonce)]])
      if (!cancelOrderTxData.data) throw new Error('Invalid cancel order data')

      const cancelOrder = {
        tx: {
          to: cancelOrderTxData.to,
          data: cancelOrderTxData.data,
          value: BigNumber.from(cancelOrderTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Cancel Order',
        ethRequired: BigNumber.from(0)
      }

      // TODO: check newOrderSize calc:
      const newOrderSize = BigInt(orderToUpdate.order_delta) + order.sizeDelta.amount.toFormat(6).value
      const replaceOrderTxData = await this.sdk.markets.build.placeOrder({
        side: order.direction === 'LONG' ? PositionSide.long : PositionSide.short,
        orderType: OrderTypes.limit,
        positionAbs: newOrderSize,
        delta: order.sizeDelta.amount.toFormat(6).value,
        limitPrice: order.triggerData?.triggerPrice.toFormat(6).value ?? BigInt(orderToUpdate.order_price),
        address: account,
        marketAddress: marketAddress
      })

      if (!replaceOrderTxData?.data) throw new Error('Invalid replace order data')

      const replaceOrder = {
        tx: {
          to: replaceOrderTxData.to,
          data: replaceOrderTxData.data,
          value: BigNumber.from(replaceOrderTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Replace Order',
        ethRequired: BigNumber.from(0)
      }

      txs.push(cancelOrder)
      txs.push(replaceOrder)
    }
    return txs
  }

  async cancelOrder(orderData: CancelOrder[], wallet: string, opts?: ApiOpts): Promise<ActionParam[]> {
    let txs: ActionParam[] = []
    for (const order of orderData) {
      const { marketId, orderId } = order
      const protocolMarketId = decodePerennialMarketId(marketId)
      const productAddress = ChainMarkets[arbitrum.id][protocolMarketId as SupportedAsset]
      if (!productAddress) throw new Error('Invalid market id')
      const cancelOrderTxData = await this.sdk.markets.build.cancelOrder([[productAddress, BigInt(orderId)]])

      if (!cancelOrderTxData?.data) {
        throw new Error('Invalid cancel order data')
      }

      txs.push({
        tx: {
          to: cancelOrderTxData.to,
          data: cancelOrderTxData.data,
          value: BigNumber.from(cancelOrderTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Cancel Order',
        ethRequired: BigNumber.from(0)
      })
    }
    return txs
  }

  async updatePositionMargin(
    positionInfo: PositionInfo[],
    updatePositionMarginData: UpdatePositionMarginData[],
    wallet: string,
    opts?: ApiOpts
  ): Promise<ActionParam[]> {
    let txs: ActionParam[] = []

    const account = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address: account, opts })
    if (!marketSnapshots?.user) throw new Error('No user position data')

    for (let i = 0; i < positionInfo.length; i++) {
      const updateData = updatePositionMarginData[i]
      const { marketId } = positionInfo[i]
      const protocolMarketId = decodePerennialMarketId(marketId)
      const productAddress = ChainMarkets[arbitrum.id][protocolMarketId as SupportedAsset]

      if (!productAddress) throw new Error('Invalid market id')

      const userPositionData = marketSnapshots.user[protocolMarketId as SupportedAsset]

      const collateralDelta = updateData.isDeposit
        ? updateData.margin.amount.toFormat(6).value
        : -updateData.margin.amount.toFormat(6).value
      const currentCollateral = userPositionData.local.collateral

      if (!updateData.isDeposit && collateralDelta > currentCollateral) {
        throw new Error('Insufficient collateral')
      }

      const positionChangeTxData = await this.sdk.markets.build.modifyPosition({
        collateralDelta,
        address: account,
        marketAddress: productAddress
      })

      if (!positionChangeTxData?.data) {
        throw new Error('Invalid position change data')
      }

      txs.push({
        tx: {
          to: positionChangeTxData.to,
          data: positionChangeTxData.data,
          value: BigNumber.from(positionChangeTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Update Position Margin',
        ethRequired: BigNumber.from(0)
      })
    }

    return txs
  }

  getProtocolInfo(): ProtocolInfo {
    // TODO: confirm values
    const info: ProtocolInfo = {
      hasAgent: false,
      hasAccount: true,
      hasOrderbook: false,
      sizeDeltaInToken: true,
      explicitFundingClaim: false,
      collateralDeltaInToken: false,
      collateralUsesLimitPricing: false,
      depositData: {
        10: [],
        42161: [tokens['USDC.e']]
      }
    }
    return info
  }

  async supportedMarkets(chains: Chain[] | undefined, opts?: ApiOpts): Promise<MarketInfo[]> {
    const marketInfo = await this._cachedMarkets(opts)
    return Object.values(marketInfo)
  }

  async getMarketPrices(marketIds: Market['marketId'][], opts?: ApiOpts): Promise<FixedNumber[]> {
    const marketSnapshots = await this._cachedMarketSnapshots({
      address: zeroAddress,
      opts
    })
    if (!marketSnapshots) {
      return []
    }
    return marketIds.map((marketId) => {
      const protocolMarketId = decodePerennialMarketId(marketId)
      console.log({ protocolMarketId })
      const market = marketSnapshots.market[protocolMarketId as SupportedAsset]
      if (!market) {
        // TODO: handle this case
        return FixedNumber.fromString('0')
      }
      return FixedNumber.fromValue(market.global.latestPrice, 6)
    })
  }

  async getMarketsInfo(marketIds: Market['marketId'][], opts?: ApiOpts): Promise<MarketInfo[]> {
    const marketsInfo: MarketInfo[] = []
    const marketInfo = await this._cachedMarkets(opts)
    for (const mId of marketIds) {
      if (marketInfo === undefined) throw new Error(`Market ${mId} not found`)

      marketsInfo.push(marketInfo[mId])
    }

    return marketsInfo
  }

  async getDynamicMarketMetadata(marketIds: Market['marketId'][], opts?: ApiOpts): Promise<DynamicMarketMetadata[]> {
    const metadata: DynamicMarketMetadata[] = []
    const marketSnapshots = await this._cachedMarketSnapshots({
      address: zeroAddress,
      opts
    })
    if (!marketSnapshots) throw new Error('No market data')

    for (const mId of marketIds) {
      const protocolMarketId = decodePerennialMarketId(mId)
      const market = marketSnapshots.market[protocolMarketId as SupportedAsset]
      if (!market) throw new Error(`Market ${mId} not found`)

      const {
        global: { latestPrice },
        nextPosition: { long, short }
      } = market
      const longOi = Big6Math.mul(long, latestPrice)
      const shortOi = Big6Math.mul(short, latestPrice)
      const liquidity = calcTakerLiquidity(market)
      const { availableLongLiquidity, availableShortLiquidity } = liquidity
      const longRate = calcFundingRates(market.fundingRate.long)
      const shortRate = calcFundingRates(market.fundingRate.short)

      metadata.push({
        oiLong: FixedNumber.fromValue(longOi, 6),
        oiShort: FixedNumber.fromValue(shortOi, 6),
        availableLiquidityLong: FixedNumber.fromValue(availableLongLiquidity, 6),
        availableLiquidityShort: FixedNumber.fromValue(availableShortLiquidity, 6),
        longFundingRate: FixedNumber.fromValue(longRate.hourlyFunding * -1n, 6),
        shortFundingRate: FixedNumber.fromValue(shortRate.hourlyFunding * -1n, 6),
        longBorrowRate: FixedNumber.fromString('0'), // TODO: figure out borrow rate
        shortBorrowRate: FixedNumber.fromString('0'),
        isOiBifurcated: false
      })
    }
    return metadata
  }

  async getTradesHistory(
    wallet: string,
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<PaginatedRes<HistoricalTradeInfo>> {
    const account = getAddress(wallet)
    const marketInfo = await this._cachedMarkets(opts)
    const marketIDs = Object.keys(marketInfo)
    const markets: Markets = []

    for (let i = 0; i < marketIDs.length; i++) {
      const protocolMarketId = decodePerennialMarketId(marketIDs[i])
      const asset = protocolMarketId.toLowerCase() as SupportedAsset
      const marketAddress = ChainMarkets[arbitrum.id][asset]
      if (!marketAddress) continue
      markets.push({ asset, marketAddress })
    }

    const tradeHistory = await this.sdk.markets.read.historicalPositions({
      address: account,
      markets,
      pageSize: pageOptions?.limit ?? 100
    })

    const trades: HistoricalTradeInfo[] = tradeHistory.positions.map((position) => {
      return {
        timestamp: new Date(position.startTime).getTime(),
        indexPrice: FixedNumber.fromValue(position.averageEntry, 6),
        collateralPrice: FixedNumber.fromValue(position.startCollateral, 6),
        realizedPnl: FixedNumber.fromValue(position.accumulated.pnl, 6),
        keeperFeesPaid: FixedNumber.fromValue(position.keeperFees, 6),
        positionFee: FixedNumber.fromValue(position.positionFees, 6),
        operationType: position.side === PositionSide.long ? 'Long' : 'Short', // TODO: this is a little loose..
        txHash: position.startTransactionHash,
        collateral: tokens['USDC.e'],
        marketId: encodePerennialMarketId(position.asset),
        direction: (position.side === PositionSide.long ? 'LONG' : 'SHORT') as TradeDirection,
        sizeDelta: toAmountInfo(BigNumber.from(position.startSize), 6, true),
        marginDelta: toAmountInfo(BigNumber.from(position.startCollateral), 6, false),
        id: position.startTransactionHash
      }
    })
    return getPaginatedResponse(trades, pageOptions)
  }

  async getAllPositions(
    wallet: string,
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<PaginatedRes<PositionInfo>> {
    const address = getAddress(wallet)
    const marketSnapshots = await this._cachedMarketSnapshots({ address, opts })
    if (!marketSnapshots?.user) {
      return {
        result: [],
        maxItemsCount: 0
      }
    }
    const userAssets = Object.keys(marketSnapshots.user) as SupportedAsset[]
    const positions: PositionInfo[] = []

    for (const asset of userAssets) {
      const positionPnl = await this._cachedActivePositionPnls({
        asset,
        address,
        marketSnapshots,
        opts
      })
      const position = marketSnapshots.user[asset]
      const market = marketSnapshots.market[asset]
      if (
        !positionPnl ||
        !position ||
        position.nextMagnitude === 0n ||
        position.nextSide === PositionSide.maker ||
        !market
      ) {
        continue
      }

      const { long, short } = calcLiquidationPrice({
        marketSnapshot: marketSnapshots.market[asset],
        position: position.nextMagnitude,
        collateral: position.local.collateral
      })
      const isLong = position.nextSide === PositionSide.long

      const liquidationPrice = FixedNumber.fromValue(isLong ? long : short, 6)
      const fundingRate = isLong
        ? calcFundingRates(market.fundingRate.long)
        : calcFundingRates(market.fundingRate.short)

      const cumulativeFunding = FixedNumber.fromValue(fundingRate.hourlyFunding, 6)
      const pnl =
        positionPnl.accumulatedPnl.pnl + positionPnl.keeperFees + positionPnl.positionFees + positionPnl.liquidationFee

      const positionInfo: PositionInfo = {
        protocolId: 'PERENNIAL',
        marketId: encodePerennialMarketId(asset),
        posId: `${address}-${asset}`,
        size: toAmountInfo(BigNumber.from(position.nextMagnitude.toString()), 6, true),
        margin: toAmountInfo(BigNumber.from(position.local.collateral), 6, false),
        direction: position.side === PositionSide.long ? 'LONG' : 'SHORT',
        unrealizedPnl: {
          aggregatePnl: FixedNumber.fromValue(positionPnl.accumulatedPnl.value, 6),
          fundingFee: FixedNumber.fromValue(-positionPnl.accumulatedPnl.funding, 6),
          borrowFee: FixedNumber.fromValue(positionPnl.accumulatedPnl.interest, 6),
          rawPnl: FixedNumber.fromValue(pnl, 6)
        },
        avgEntryPrice: FixedNumber.fromValue(positionPnl.averageEntryPrice, 6),
        liquidationPrice,
        mode: 'ISOLATED',
        cumulativeFunding,
        leverage: FixedNumber.fromValue(position.nextLeverage, 6),
        indexToken: assetToRageToken(asset),
        collateral: tokens['USDC.e'],
        accessibleMargin: toAmountInfo(BigNumber.from(position.local.collateral), 6, false), // TODO: Check this,
        roe: FixedNumber.fromValue(positionPnl.realtimePercent, 6),
        metadata: ''
      }

      positions.push(positionInfo)
    }

    return getPaginatedResponse(positions, pageOptions)
  }

  async getAllOrders(
    wallet: string,
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<PaginatedRes<OrderInfo>> {
    const account = getAddress(wallet)
    const markets = chainAssetsWithAddress(arbitrum.id)
    const openOrderGraphData = await this.sdk.markets.read.openOrders({
      address: account,
      markets,
      pageParam: pageOptions?.skip ?? 0,
      pageSize: pageOptions?.limit ?? 100
    })
    const openOrders = openOrderGraphData.openOrders.map(formatOpenOrderToOrderInfo)
    return getPaginatedResponse(openOrders, pageOptions)
  }

  async getAllOrdersForPosition(
    wallet: string,
    positionInfo: PositionInfo[],
    pageOptions: PageOptions | undefined,
    opts?: ApiOpts
  ): Promise<Record<PositionData['posId'], PaginatedRes<OrderInfo>>> {
    const account = getAddress(wallet)
    const markets = chainAssetsWithAddress(arbitrum.id)
    const openOrderGraphData = await this.sdk.markets.read.openOrders({
      address: account,
      markets,
      pageParam: pageOptions?.skip ?? 0,
      pageSize: pageOptions?.limit ?? 100
    })
    const ordersForPositionInternal: Record<string, OrderInfo[]> = {}

    for (const o of openOrderGraphData.openOrders) {
      for (const p of positionInfo) {
        const protocolMarketId = decodePerennialMarketId(p.marketId)
        const orderMarket = addressToAsset(getAddress(o.market))
        if (protocolMarketId === orderMarket) {
          if (ordersForPositionInternal[p.posId] === undefined) {
            ordersForPositionInternal[p.posId] = []
          }
          ordersForPositionInternal[p.posId].push(formatOpenOrderToOrderInfo(o))
        }
      }
    }
    const ordersForPosition: Record<string, PaginatedRes<OrderInfo>> = {}
    for (const posId of Object.keys(ordersForPositionInternal)) {
      ordersForPosition[posId] = getPaginatedResponse(ordersForPositionInternal[posId], pageOptions)
    }
    return ordersForPosition
  }

  /** Internal Methods */
  async _checkMarketFactoryApproval(wallet: string) {
    const account = getAddress(wallet)
    const operatorApproved = await this.sdk.operator.read.marketFactoryApproval({
      address: account
    })
    return operatorApproved
  }

  async _approveMarketFactory(wallet: string): Promise<ActionParam | undefined> {
    if (this.operatorApproved || (await this._checkMarketFactoryApproval(wallet))) {
      return
    }
    const approveTxData = await this.sdk.operator.build.approveMarketFactoryTx()

    if (approveTxData.data) {
      return {
        tx: {
          to: approveTxData.to,
          data: approveTxData.data,
          value: BigNumber.from(approveTxData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Approve Market Factory',
        ethRequired: BigNumber.from(0)
      }
    }
    return
  }

  async _checkUSDCApproval(wallet: string, amount: bigint) {
    const account = getAddress(wallet)
    const usdcContract = this.sdk.contracts.getUSDCContract()
    const usdcAllowance = await usdcContract.read.allowance([account, MultiInvokerAddresses[arbitrum.id]])
    return usdcAllowance >= amount
  }

  async _approveUSDC({
    account,
    market,
    amount,
    marketSnapshots
  }: {
    account: Address
    market: SupportedAsset
    amount?: bigint
    marketSnapshots?: MarketSnapshots
  }): Promise<ActionParam | undefined> {
    const productAddress = ChainMarkets[arbitrum.id][market]
    if (!productAddress) throw new Error('Invalid market id')

    const txData = await this.sdk.operator.build.approveUSDC({ suggestedAmount: amount })

    if (txData.data) {
      return {
        tx: {
          to: txData.to,
          data: txData.data,
          value: BigNumber.from(txData.value),
          chainId: arbitrum.id
        },
        desc: EMPTY_DESC,
        chainId: arbitrum.id,
        isUserAction: true,
        isAgentRequired: false,
        heading: 'Perennial Approve USDC',
        ethRequired: BigNumber.from(0)
      }
    } else {
      throw new Error('Invalid approve USDC tx data')
    }
  }

  async _fetchSupportedMarkets(opts?: ApiOpts): Promise<Record<string, MarketInfo>> {
    const protocol: Protocol = {
      protocolId: 'PERENNIAL'
    }
    const marketSnapshots = await this._cachedMarketSnapshots({
      address: zeroAddress,
      opts
    })
    if (!marketSnapshots) {
      return {}
    }
    const marketKeys = Object.keys(marketSnapshots.market) as SupportedAsset[]
    return marketKeys.reduce((acc: Record<string, MarketInfo>, key) => {
      const market = marketSnapshots.market[key]
      if (!market) {
        return acc
      }
      const { asset } = market
      const rageAsset = assetToRageToken(asset)

      const marketId = encodePerennialMarketId(rageAsset.symbol)
      const maxLeverage = calcMaxLeverage({
        margin: market.riskParameter.margin,
        minMargin: market.riskParameter.minMargin,
        collateral: marketSnapshots?.user?.[key].local.collateral ?? 0n
      })

      // Adjust max leverage for app to min(100x, maxLev rounded down to nearest 5x)
      const adjustedMaxLeverage = Big6Math.min(
        Big6Math.ONE * 100n,
        (maxLeverage / Big6Math.fromFloatString('5')) * Big6Math.fromFloatString('5')
      )

      acc[marketId] = {
        marketId,
        marketSymbol: rageAsset.symbol,
        chain: arbitrumChain,
        indexToken: rageAsset,
        longCollateral: [PNL_COLLATERAL_TOKEN],
        shortCollateral: [PNL_COLLATERAL_TOKEN],
        supportedModes: {
          ISOLATED: true,
          CROSS: false
        },
        supportedOrderTypes: {
          LIMIT: true,
          MARKET: true,
          STOP_LOSS: true,
          TAKE_PROFIT: true,
          STOP_LOSS_LIMIT: false, // TODO: ?
          TAKE_PROFIT_LIMIT: false
        },
        supportedOrderActions: {
          CREATE: true,
          UPDATE: true,
          CANCEL: true
        },
        minLeverage: FixedNumber.fromString('0.1'),
        maxLeverage: FixedNumber.fromValue(adjustedMaxLeverage, 6),
        minInitialMargin: FixedNumber.fromValue(market.riskParameter.minMargin, 6),
        amountStep: undefined,
        priceStep: undefined,
        minPositionSize: FixedNumber.fromString('0.01'),
        maxPrecision: 6,
        minPositionSizeToken: ZERO_FN,
        ...protocol
      }

      return acc
    }, {})
  }

  async _cachedMarkets(opts?: ApiOpts): Promise<Record<string, MarketInfo>> {
    const sTime = getStaleTime(CACHE_DAY, opts)
    const res = cacheFetch({
      key: [PERENNIAL_CACHE_PREFIX, 'cachedMarkets'],
      fn: async () => {
        const markets = await this._fetchSupportedMarkets(opts)
        return markets
      },
      staleTime: sTime,
      cacheTime: sTime * CACHE_TIME_MULT,
      opts
    })
    return res
  }

  async _cachedMarketSnapshots({
    address,
    opts
  }: {
    address: Address
    opts?: ApiOpts
  }): Promise<MarketSnapshots | undefined> {
    const sTime = getStaleTime(30 * CACHE_SECOND, opts)
    const res = cacheFetch({
      key: [PERENNIAL_CACHE_PREFIX, address, 'marketSnapshots'],
      fn: async () => {
        const marketSnapshots = await this.sdk.markets.read.marketSnapshots({ address })
        return marketSnapshots
      },
      staleTime: sTime,
      cacheTime: sTime * CACHE_TIME_MULT,
      opts
    })
    return res
  }

  async _cachedActivePositionPnls({
    asset,
    address,
    marketSnapshots,
    opts
  }: {
    asset: SupportedAsset
    address: Address
    marketSnapshots: MarketSnapshots
    opts?: ApiOpts
  }) {
    const sTime = getStaleTime(CACHE_DAY, opts)
    const marketSnapshot = marketSnapshots.market[asset]
    const userMarketSnapshot = marketSnapshots.user?.[asset]
    if (!marketSnapshot || !userMarketSnapshot) return undefined

    const res = cacheFetch({
      // Cache on the market snapshot version to ensure we don't use stale data
      key: [
        PERENNIAL_CACHE_PREFIX,
        asset,
        address,
        Number(marketSnapshot.pre.latestOracleVersion.timestamp),
        'activePositionPnls'
      ],
      fn: async () => {
        const pnlData = await this.sdk.markets.read.activePositionPnl({
          market: marketSnapshot.market,
          address,
          marketSnapshot,
          userMarketSnapshot
        })
        return pnlData
      },
      staleTime: sTime,
      cacheTime: sTime * CACHE_TIME_MULT,
      opts
    })
    return res
  }

  async _listenAndInvalidateOnMarketUpdates() {
    const marketsOracles = await this.sdk.markets.read.marketOracles()

    Object.values(marketsOracles).map((oracle) => {
      this.sdk.publicClient.watchContractEvent({
        address: oracle.providerAddress,
        abi: KeeperOracleAbi,
        eventName: 'OracleProviderVersionFulfilled',
        pollingInterval: CACHE_SECOND * 10, // poll every 10 seconds
        onLogs: async () => {
          await invalidateCacheByKeyComponents([PERENNIAL_CACHE_PREFIX, 'marketSnapshots'])
        }
      })
    })
  }
}
