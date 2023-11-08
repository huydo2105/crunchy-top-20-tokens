const axios = require('axios');
const { BigNumber } = require('bignumber.js');
const tokensBlocked = require("./tokensBlocked.json");

const TEZ_AND_WRAPPED_TEZ_ADDRESSES = [
  "tez",
  "KT1UpeXdK6AJbX58GJ92pLZVCucn2DR8Nu4b",
  "KT1PnUZCp3u2KzWr93pn4DD7HAJnm3rWVrgn",
  "KT1SjXiUX63QvdNMcM2m492f7kuf8JxXRLp4",
];
const ALIEN_FEE_DENOMINATOR = new BigNumber(1000000000000000000n);

async function getXtzUsdPrice() {
  try {
    const response = await axios.get('https://api.tzkt.io/v1/quotes/last');
    return response.data;
  } catch (error) {
    console.error('Error fetching data from tokenPools API:', error);
    return [];
  }
}

async function fetchTokenPools() {
  try {
    const response = await axios.get('https://api.crunchy.network/v1/pools');
    return response.data;
  } catch (error) {
    console.error('Error fetching data from tokenPools API:', error);
    return [];
  }
}


async function fetchTokenSpotData() {
  try {
    const response = await axios.get('https://api.crunchy.network/v1/tokens/quotes/spot');
    return response.data;
  } catch (error) {
    console.error('Error fetching data from tokenSpot API:', error);
    return [];
  }
}


async function fetchToken1DayData() {
  try {
    const response = await axios.get('https://dex-indexer-api.onrender.com/v1/tokens/quotes/last/1d');
    return response.data;
  } catch (error) {
    console.error('Error fetching data from token1Day API:', error);
    return [];
  }
}

function calculateTokenPools(tokenSpot, allTokenPools) {
  return tokenSpot.map((token) => {
    // Assign exchanges property to pools
    const tokenPools = allTokenPools.filter((el) => {
      // Check if either of the two tokens in the "tokens" field matches the criteria
      const tokenMatches = el.tokens.some((pool) => {
        return (
          pool.token.tokenAddress === token.tokenAddress &&
          pool.token.tokenId === token.tokenId
        );
      });
      // Return true if either token matches the criteria
      return tokenMatches;
    });
    return { ...token, exchanges: tokenPools};
  });
}

function calculateTokenPriceAndTVL(tokenPools, xtzUSD) {
  return tokenPools.map((token) => {
    //Calculate token price
    const tokenAddress_tokenId = `${token.tokenAddress}_${token.tokenId}`;

    if (tokensBlocked.includes(tokenAddress_tokenId)) {
      return { ...token, currentPrice : 0 }; 
    }
    const currentPrice = !TEZ_AND_WRAPPED_TEZ_ADDRESSES.includes(token.tokenAddress) 
      ? token?.quotes.find((el) =>
        TEZ_AND_WRAPPED_TEZ_ADDRESSES.includes(el.token.tokenAddress)
        )?.quote 
      : 1;
    const currentPriceUsd = currentPrice * xtzUSD;

    let tokenTvl = 0;
    //Calculate token tvl
    if(token.exchanges) {
      token.exchanges.forEach((e, index) => {
        const foundPool = e.tokens.find(
          (ele) =>
            ele.token.tokenAddress === token.tokenAddress &&
            ele.token.tokenId === token.tokenId
        );
  
        let tokenReserves = 0;
        if (e.dex.type === "alien") {
          tokenReserves =
            token.reserves /
            (ALIEN_FEE_DENOMINATOR * Math.pow(10, foundPool.token.decimals));
        } else {
          tokenReserves = foundPool.reserves / Math.pow(10, foundPool.token.decimals);
        }
        token.exchanges[index].tokenTvl =
          new BigNumber(tokenReserves * currentPrice).toNumber() ||
          0;
        tokenTvl += token.exchanges[index].tokenTvl;
      });
    }

    return { ...token, currentPrice, currentPriceUsd, tokenTvl };
  });
}

function calculateTokenPrice1Day(token1Day, xtzUSD) {
  return token1Day.map((token) => {
    //Calculate token price
    const tokenAddress_tokenId = `${token.tokenAddress}_${token.tokenId}`;
    if(TEZ_AND_WRAPPED_TEZ_ADDRESSES.includes(token.tokenAddress)) {
        return { ...token, currentPrice : 1, currentPriceUsd : xtzUSD }; 
    }
    if (tokensBlocked.includes(tokenAddress_tokenId)) {
      return { ...token, currentPrice : 0 }; 
    }
    const currentPrice = !TEZ_AND_WRAPPED_TEZ_ADDRESSES.includes(token.tokenAddress) 
      ?  token?.quotes.find((el) =>
        TEZ_AND_WRAPPED_TEZ_ADDRESSES.includes(el.token.tokenAddress)
      )?.buckets[0]?.close
      : 1;
    const currentPriceUsd = currentPrice * xtzUSD;


    return { ...token, currentPrice, currentPriceUsd };
  });
}
function calculateMarketCap(tokenData) {
    return tokenData.map((token) => {
      if (!Number(token.currentPrice) || !Number(token.totalSupply)) {
        return { ...token, marketCap: 0 };
      }
      if(token.tokenTvl < 5000) {
        return { ...token, marketCap: 0 };
      }
      const calcSupply = new BigNumber(token.totalSupply)
        .div(new BigNumber(10).pow(token.decimals))
        .toNumber();
      const marketCap = new BigNumber(calcSupply)
        .times(token.currentPrice)
        .toNumber();
      return { ...token, marketCap };
    });
}

function calculatePriceChange(tokenSpot, token1Day) {
  // Create a map for token1Day data for easy access
  const token1DayMap = new Map();
  token1Day.forEach((token) => {
    const tokenAddress_tokenId = `${token.tokenAddress}_${token.tokenId}`;
    token1DayMap.set(tokenAddress_tokenId, token);
  });

  // Calculate price change for each token in tokenSpot
  const priceChanges = tokenSpot.map((token) => {
    const tokenAddress_tokenId = `${token.tokenAddress}_${token.tokenId}`;
    const token1DayData = token1DayMap.get(tokenAddress_tokenId);

    if (token1DayData) {
      const currentPrice = parseFloat(token.currentPrice);
      const price1DayAgo = parseFloat(token1DayData.currentPrice);
      const priceChange = (currentPrice - price1DayAgo) / price1DayAgo * 100; // Calculate percentage change

      return {
        ...token,
        priceChange: priceChange,
      };
  } else {
    return {...token, priceChange: 0}; // Skip tokens with missing data
  }
}
);

// Remove null entries (tokens with missing data)
return priceChanges.filter((entry) => entry !== null);
}

async function main() {
  const xtzPrice = await getXtzUsdPrice();
  const xtzUSD = xtzPrice.usd;

  const allTokenPools = await fetchTokenPools();
  const tokenSpotData = await fetchTokenSpotData();
  const token1DayData = await fetchToken1DayData();

  const tokensWithPools = calculateTokenPools(tokenSpotData, allTokenPools)
  const tokensWithPrices = calculateTokenPriceAndTVL(tokensWithPools, xtzUSD);
  const tokensWithMarketCap = calculateMarketCap(tokensWithPrices);
  const token1DayWithPrices = calculateTokenPrice1Day(token1DayData, xtzUSD);

  const tokenWithPriceChange = calculatePriceChange(tokensWithMarketCap, token1DayWithPrices);


  // Get the top 20 tokens based on market cap
  const top20Tokens = tokenWithPriceChange
    .filter((token) => token.marketCap)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 20);

    console.log('Tokens With Marketcap:');
  // Sort the tokens by marketCap
  top20Tokens.sort((a, b) => b.marketCap - a.marketCap);
  
  // Loop through and log the sorted tokens
  top20Tokens.forEach((token, index) => {
    console.log(`${index + 1}. Symbol: ${token.symbol}, Current Price: ${token.currentPrice}, Current Price USD: ${token.currentPriceUsd}, TokenTVL: ${token.tokenTvl}, priceChange: ${token.priceChange}, Marketcap: ${token.marketCap}`);
  });

}

main();
