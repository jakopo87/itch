import React from "react";
import { Game, Collection } from "common/butlerd/messages";
import Button from "renderer/basics/Button";
import styled from "renderer/styles";
import { urlForCollection } from "common/util/navigation";

class RemoveFromCollectionAction extends React.PureComponent<Props> {
  onClick = (e: React.MouseEvent<any>) => {
    e.stopPropagation();

    let url =
      urlForCollection(this.props.collectionId) +
      `/remove/${this.props.gameId}`;
    alert(url);

    // fetch(url, { method: 'POST' }).then(function (result) {
    //   console.log(result);
    // });
  };

  render() {
    return (
      <Button
        onClick={this.onClick}
        className={"main-action"}
        label={"Remove"}
      />
    );
  }
}

interface Props {
  gameId: number;
  collectionId: number;
}

const UncollapsibleMainAction = styled(RemoveFromCollectionAction)`
  flex-shrink: 0;
`;

export default ({
  gameId,
  collectionId,
}: {
  gameId: number;
  collectionId: number;
}) => <UncollapsibleMainAction gameId={gameId} collectionId={collectionId} />;
