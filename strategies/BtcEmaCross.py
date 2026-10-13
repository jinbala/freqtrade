"""A small spot-only EMA crossover strategy for paper trading."""

import talib.abstract as ta
from pandas import DataFrame

from freqtrade.strategy import IStrategy


class BtcEmaCross(IStrategy):
    INTERFACE_VERSION = 3
    can_short = False
    timeframe = "5m"
    startup_candle_count = 200
    process_only_new_candles = True

    # Exit on a bearish crossover, 2% profit, or a 3% stop loss.
    minimal_roi = {"0": 0.02}
    stoploss = -0.03
    trailing_stop = False
    use_exit_signal = True
    exit_profit_only = False
    position_adjustment_enable = False

    order_types = {
        "entry": "market",
        "exit": "market",
        "stoploss": "market",
        "stoploss_on_exchange": False,
    }
    order_time_in_force = {"entry": "GTC", "exit": "GTC"}
    plot_config = {"main_plot": {"ema_fast": {}, "ema_slow": {}}}

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["ema_fast"] = ta.EMA(dataframe, timeperiod=20)
        dataframe["ema_slow"] = ta.EMA(dataframe, timeperiod=50)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["ema_fast"] > dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) <= dataframe["ema_slow"].shift(1))
            & (dataframe["volume"] > 0),
            ["enter_long", "enter_tag"],
        ] = (1, "ema20_cross_above_ema50")
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["ema_fast"] < dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) >= dataframe["ema_slow"].shift(1))
            & (dataframe["volume"] > 0),
            ["exit_long", "exit_tag"],
        ] = (1, "ema20_cross_below_ema50")
        return dataframe
