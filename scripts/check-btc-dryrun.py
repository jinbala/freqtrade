"""Validate the resolved trading configuration before launching the bot.

Use uncaught exceptions here: some Freqtrade CLI configuration errors exit 0.
"""

from freqtrade.commands import Arguments
from freqtrade.configuration import Configuration
from freqtrade.configuration.config_validation import validate_config_consistency
from freqtrade.resolvers import StrategyResolver


def main() -> None:
    args = Arguments(
        [
            "trade",
            "--dry-run",
            "--config",
            "user_data/config-btc-dryrun.json",
            "--userdir",
            "user_data",
            "--strategy",
            "BtcEmaCross",
            "--strategy-path",
            "strategies",
        ]
    ).get_parsed_arg()
    config = Configuration(args).get_config()
    StrategyResolver.load_strategy(config)
    validate_config_consistency(config)
    print("Trading configuration and BtcEmaCross strategy validated (dry-run).")


if __name__ == "__main__":
    main()
